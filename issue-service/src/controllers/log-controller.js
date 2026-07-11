const mongoose = require("mongoose");
const { LogEntry } = require("../models/issue-model");
const { ApiError, LogLevel, asyncHandler } = require("../utils/constants");

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

const ensureObjectId = (value, fieldName) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new ApiError(400, `${fieldName} is invalid`);
  }
};

const parsePagination = (query) => {
  const parsedPage = Number.parseInt(query.page || "1", 10);
  const rawLimit = Number.parseInt(query.limit || `${DEFAULT_LIMIT}`, 10);

  if (!Number.isFinite(parsedPage) || parsedPage < 1) {
    throw new ApiError(400, "page must be a positive number");
  }

  if (!Number.isFinite(rawLimit) || rawLimit < 1) {
    throw new ApiError(400, "limit must be a positive number");
  }

  const page = parsedPage;
  const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const parseDate = (value, fieldName) => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `${fieldName} must be a valid date`);
  }

  return parsed;
};

// See issue-controller.js's identical comment: $text only matches whole/
// stemmed words against the text index, so a partial substring typed into
// the search box returns nothing even when a matching log line exists. A
// regex-based partial match is what the "search as you type" UX needs;
// `query.search` is Joi-validated to a plain string upstream but is
// escaped here anyway so it's matched literally, not as a regex pattern.
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildLogFilter = ({ query, organizationId }) => {
  const filter = {
    organizationId: new mongoose.Types.ObjectId(organizationId),
  };

  if (query.projectId) {
    ensureObjectId(query.projectId, "projectId");
    filter.projectId = new mongoose.Types.ObjectId(query.projectId);
  }

  if (query.level) {
    if (!Object.values(LogLevel).includes(query.level)) {
      throw new ApiError(
        400,
        `level must be one of: ${Object.values(LogLevel).join(", ")}`,
      );
    }

    filter.level = query.level;
  }

  if (query.traceId) {
    filter.traceId = query.traceId;
  }

  if (query.correlationId) {
    filter.correlationId = query.correlationId;
  }

  const dateFrom = parseDate(query.dateFrom, "dateFrom");
  const dateTo = parseDate(query.dateTo, "dateTo");

  if (dateFrom || dateTo) {
    filter.occurredAt = {};

    if (dateFrom) {
      filter.occurredAt.$gte = dateFrom;
    }

    if (dateTo) {
      filter.occurredAt.$lte = dateTo;
    }
  }

  if (query.search) {
    filter.message = new RegExp(escapeRegExp(query.search), "i");
  }

  return filter;
};

const serializeLogEntry = (entry) => ({
  id: entry._id,
  entryId: entry.entryId,
  batchId: entry.batchId,
  projectId: entry.projectId,
  organizationId: entry.organizationId,
  level: entry.level,
  message: entry.message,
  logger: entry.logger,
  traceId: entry.traceId,
  correlationId: entry.correlationId,
  context: entry.context,
  release: entry.release,
  environment: entry.environment,
  occurredAt: entry.occurredAt,
  receivedAt: entry.receivedAt,
  createdAt: entry.createdAt,
});

const listLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = buildLogFilter({
    query: req.query,
    organizationId: req.user.organizationId,
  });
  const sortDirection = req.query.order === "asc" ? 1 : -1;

  const [logs, total] = await Promise.all([
    LogEntry.find(filter)
      .sort({ occurredAt: sortDirection })
      .skip(skip)
      .limit(limit)
      .lean(),
    LogEntry.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      logs: logs.map(serializeLogEntry),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

module.exports = {
  listLogs,
};
