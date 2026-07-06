const mongoose = require("mongoose");
const { Issue, IssueEvent } = require("../models/issue-model");
const {
  ApiError,
  Environments,
  IssueStatus,
  Severity,
  asyncHandler,
} = require("../utils/constants");
const logger = require("../utils/logger");

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

const getSortPipeline = (sortBy = "lastSeen", order = "desc") => {
  const direction = order === "asc" ? 1 : -1;

  if (sortBy === "severity") {
    return [
      {
        $addFields: {
          severityRank: {
            $switch: {
              branches: [
                { case: { $eq: ["$severity", "critical"] }, then: 4 },
                { case: { $eq: ["$severity", "high"] }, then: 3 },
                { case: { $eq: ["$severity", "medium"] }, then: 2 },
                { case: { $eq: ["$severity", "low"] }, then: 1 },
              ],
              default: 0,
            },
          },
        },
      },
      { $sort: { severityRank: direction, lastSeen: -1 } },
      { $project: { severityRank: 0 } },
    ];
  }

  const allowedSorts = new Set([
    "lastSeen",
    "firstSeen",
    "occurrenceCount",
    "createdAt",
  ]);
  const sortField = allowedSorts.has(sortBy) ? sortBy : "lastSeen";

  return [{ $sort: { [sortField]: direction } }];
};

const buildIssueFilter = ({ query, organizationId }) => {
  const filter = { organizationId: new mongoose.Types.ObjectId(organizationId) };

  if (query.projectId) {
    ensureObjectId(query.projectId, "projectId");
    filter.projectId = new mongoose.Types.ObjectId(query.projectId);
  }

  if (query.status) {
    if (!Object.values(IssueStatus).includes(query.status)) {
      throw new ApiError(
        400,
        `status must be one of: ${Object.values(IssueStatus).join(", ")}`,
      );
    }

    filter.status = query.status;
  }

  if (query.severity) {
    if (!Object.values(Severity).includes(query.severity)) {
      throw new ApiError(
        400,
        `severity must be one of: ${Object.values(Severity).join(", ")}`,
      );
    }

    filter.severity = query.severity;
  }

  if (query.environment) {
    if (!Object.values(Environments).includes(query.environment)) {
      throw new ApiError(
        400,
        `environment must be one of: ${Object.values(Environments).join(", ")}`,
      );
    }

    filter.lastEnvironment = query.environment;
  }

  if (query.release) {
    filter.lastRelease = query.release;
  }

  if (query.errorName) {
    filter.errorName = query.errorName;
  }

  const dateFrom = parseDate(query.dateFrom, "dateFrom");
  const dateTo = parseDate(query.dateTo, "dateTo");

  if (dateFrom || dateTo) {
    filter.lastSeen = {};

    if (dateFrom) {
      filter.lastSeen.$gte = dateFrom;
    }

    if (dateTo) {
      filter.lastSeen.$lte = dateTo;
    }
  }

  if (query.search) {
    filter.$text = { $search: query.search };
  }

  return filter;
};

const serializeIssue = (issue) => ({
  id: issue._id,
  projectId: issue.projectId,
  organizationId: issue.organizationId,
  fingerprint: issue.fingerprint,
  fingerprintVersion: issue.fingerprintVersion,
  title: issue.title,
  message: issue.message,
  errorName: issue.errorName,
  culprit: issue.culprit,
  severity: issue.severity,
  status: issue.status,
  occurrenceCount: issue.occurrenceCount,
  firstSeen: issue.firstSeen,
  lastSeen: issue.lastSeen,
  lastRelease: issue.lastRelease,
  lastEnvironment: issue.lastEnvironment,
  regression: issue.regression,
  resolvedAt: issue.resolvedAt,
  resolvedBy: issue.resolvedBy,
  ignoredAt: issue.ignoredAt,
  ignoredBy: issue.ignoredBy,
  reopenedAt: issue.reopenedAt,
  reopenedBy: issue.reopenedBy,
  createdAt: issue.createdAt,
  updatedAt: issue.updatedAt,
});

const serializeIssueEvent = (event) => ({
  id: event._id,
  issueId: event.issueId,
  sourceEventId: event.sourceEventId,
  ingestionId: event.ingestionId,
  projectId: event.projectId,
  organizationId: event.organizationId,
  message: event.message,
  normalizedMessage: event.normalizedMessage,
  errorName: event.errorName,
  stackTrace: event.stackTrace,
  topFrame: event.topFrame,
  request: event.request,
  runtime: event.runtime,
  server: event.server,
  release: event.release,
  environment: event.environment,
  severity: event.severity,
  occurredAt: event.occurredAt,
  receivedAt: event.receivedAt,
  processedAt: event.processedAt,
  createdAt: event.createdAt,
});

const findIssueForRequest = async ({ issueId, organizationId }) => {
  ensureObjectId(issueId, "issueId");

  const issue = await Issue.findOne({
    _id: issueId,
    organizationId,
  });

  if (!issue) {
    throw new ApiError(404, "Issue not found");
  }

  return issue;
};

const listIssues = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = buildIssueFilter({
    query: req.query,
    organizationId: req.user.organizationId,
  });
  const sortPipeline = getSortPipeline(req.query.sortBy, req.query.order);

  const [issues, total] = await Promise.all([
    Issue.aggregate([
      { $match: filter },
      ...sortPipeline,
      { $skip: skip },
      { $limit: limit },
    ]),
    Issue.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      issues: issues.map(serializeIssue),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

const getIssue = asyncHandler(async (req, res) => {
  const issue = await findIssueForRequest({
    issueId: req.params.issueId,
    organizationId: req.user.organizationId,
  });

  const latestEvent = await IssueEvent.findOne({
    issueId: issue._id,
    organizationId: req.user.organizationId,
  })
    .sort({ occurredAt: -1 })
    .lean();

  return res.status(200).json({
    success: true,
    data: {
      issue: serializeIssue(issue),
      latestEvent: latestEvent ? serializeIssueEvent(latestEvent) : null,
    },
  });
});

const listIssueEvents = asyncHandler(async (req, res) => {
  const issue = await findIssueForRequest({
    issueId: req.params.issueId,
    organizationId: req.user.organizationId,
  });
  const { page, limit, skip } = parsePagination(req.query);

  const eventFilter = {
    issueId: issue._id,
    organizationId: req.user.organizationId,
  };

  const [events, total] = await Promise.all([
    IssueEvent.find(eventFilter)
      .sort({ occurredAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    IssueEvent.countDocuments(eventFilter),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      events: events.map(serializeIssueEvent),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

const setIssueStatus = async ({ issue, status, userId }) => {
  const now = new Date();

  issue.status = status;

  if (status === IssueStatus.RESOLVED) {
    issue.resolvedAt = now;
    issue.resolvedBy = userId;
    issue.ignoredAt = undefined;
    issue.ignoredBy = undefined;
    issue.regression = false;
  }

  if (status === IssueStatus.IGNORED) {
    issue.ignoredAt = now;
    issue.ignoredBy = userId;
    issue.resolvedAt = undefined;
    issue.resolvedBy = undefined;
  }

  if (status === IssueStatus.UNRESOLVED) {
    issue.reopenedAt = now;
    issue.reopenedBy = userId;
    issue.resolvedAt = undefined;
    issue.resolvedBy = undefined;
    issue.ignoredAt = undefined;
    issue.ignoredBy = undefined;
  }

  await issue.save();
  logger.info(`Issue ${issue._id} status changed to ${status} by ${userId}`);
  return issue;
};

const validateIssueStatus = (status) => {
  if (!Object.values(IssueStatus).includes(status)) {
    throw new ApiError(
      400,
      `status must be one of: ${Object.values(IssueStatus).join(", ")}`,
    );
  }
};

const updateIssueStatus = asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  validateIssueStatus(status);

  const issue = await findIssueForRequest({
    issueId: req.params.issueId,
    organizationId: req.user.organizationId,
  });

  const updatedIssue = await setIssueStatus({
    issue,
    status,
    userId: req.user.sub,
  });

  return res.status(200).json({
    success: true,
    data: {
      issue: serializeIssue(updatedIssue),
    },
  });
});

module.exports = {
  getIssue,
  listIssueEvents,
  listIssues,
  updateIssueStatus,
};
