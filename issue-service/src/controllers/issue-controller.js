const mongoose = require("mongoose");
const {
  Issue,
  IssueEvent,
  PerformanceTransaction,
} = require("../models/issue-model");
const {
  ApiError,
  Environments,
  IssueStatus,
  Severity,
  asyncHandler,
} = require("../utils/constants");
const logger = require("../utils/logger");

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 5;
const DEFAULT_PERFORMANCE_DAYS = 14;
const MAX_PERFORMANCE_ROWS = 5000;

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

const subtractDays = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
};

const percentile = (values, target) => {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((target / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
};

const roundMetric = (value) => Math.round((value || 0) * 100) / 100;

const getEndpointKey = ({ method, route }) =>
  Buffer.from(`${method} ${route}`, "utf8").toString("base64url");

const parseEndpointKey = (endpointId) => {
  let decoded;

  try {
    decoded = Buffer.from(endpointId, "base64url").toString("utf8");
  } catch (error) {
    throw new ApiError(400, "endpointId is invalid");
  }

  const separatorIndex = decoded.indexOf(" ");

  if (separatorIndex < 1) {
    throw new ApiError(400, "endpointId is invalid");
  }

  return {
    method: decoded.slice(0, separatorIndex),
    route: decoded.slice(separatorIndex + 1),
  };
};

const buildPerformanceFilter = ({ query, organizationId }) => {
  const filter = {
    organizationId: new mongoose.Types.ObjectId(organizationId),
  };

  if (query.projectId) {
    ensureObjectId(query.projectId, "projectId");
    filter.projectId = new mongoose.Types.ObjectId(query.projectId);
  }

  if (query.environment) {
    if (!Object.values(Environments).includes(query.environment)) {
      throw new ApiError(
        400,
        `environment must be one of: ${Object.values(Environments).join(", ")}`,
      );
    }

    filter.environment = query.environment;
  }

  if (query.release) {
    filter.release = query.release;
  }

  const dateFrom =
    parseDate(query.dateFrom, "dateFrom") ||
    subtractDays(DEFAULT_PERFORMANCE_DAYS);
  const dateTo = parseDate(query.dateTo, "dateTo");

  filter.occurredAt = { $gte: dateFrom };

  if (dateTo) {
    filter.occurredAt.$lte = dateTo;
  }

  return filter;
};

const summarizeTransactions = (transactions) => {
  const durations = transactions.map((transaction) => transaction.durationMs);
  const requestCount = transactions.length;
  const errorCount = transactions.filter(
    (transaction) => transaction.statusCode >= 500,
  ).length;
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);

  return {
    requestCount,
    errorCount,
    errorRate: requestCount ? roundMetric((errorCount / requestCount) * 100) : 0,
    averageDurationMs: requestCount
      ? roundMetric(totalDuration / requestCount)
      : 0,
    p50DurationMs: roundMetric(percentile(durations, 50)),
    p75DurationMs: roundMetric(percentile(durations, 75)),
    p95DurationMs: roundMetric(percentile(durations, 95)),
    p99DurationMs: roundMetric(percentile(durations, 99)),
    minDurationMs: requestCount ? Math.min(...durations) : 0,
    maxDurationMs: requestCount ? Math.max(...durations) : 0,
  };
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
  const filter = {
    organizationId: new mongoose.Types.ObjectId(organizationId),
  };

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

// includeSpans defaults to true for getTrace, the one place spans are the
// actual point of the response. List views (getEndpointPerformance's
// slowest/recent) pass includeSpans: false - each span can carry an
// arbitrary-shape data payload (see the P1 fix in issue-model.js), and a
// list of 10-20 transactions has no business shipping that much nested
// data over the wire when the caller just wants to scan durations/status
// codes and click into a specific trace for the full detail.
const serializeTransaction = (transaction, { includeSpans = true } = {}) => ({
  id: transaction._id,
  transactionId: transaction.transactionId,
  projectId: transaction.projectId,
  organizationId: transaction.organizationId,
  name: transaction.name,
  method: transaction.method,
  route: transaction.route,
  url: transaction.url,
  durationMs: transaction.durationMs,
  statusCode: transaction.statusCode,
  traceId: transaction.traceId,
  spanId: transaction.spanId,
  spans: includeSpans ? transaction.spans : undefined,
  tags: transaction.tags,
  release: transaction.release,
  environment: transaction.environment,
  occurredAt: transaction.occurredAt,
  receivedAt: transaction.receivedAt,
  processedAt: transaction.processedAt,
  createdAt: transaction.createdAt,
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

const listPerformanceEndpoints = asyncHandler(async (req, res) => {
  const filter = buildPerformanceFilter({
    query: req.query,
    organizationId: req.user.organizationId,
  });
  const slowThresholdMs = Number.parseFloat(req.query.slowThresholdMs || "1000");

  // Pure aggregate endpoint - summarizeTransactions/getEndpointKey only
  // ever read method/route/environment/occurredAt/durationMs/statusCode,
  // so spans/tags never needed to leave Mongo for this query in the first
  // place (see the P1 fix in issue-model.js for why spans in particular
  // are worth excluding proactively).
  const transactions = await PerformanceTransaction.find(filter)
    .select("-spans -tags")
    .sort({ occurredAt: -1 })
    .limit(MAX_PERFORMANCE_ROWS)
    .lean();

  const grouped = transactions.reduce((result, transaction) => {
    const key = `${transaction.method} ${transaction.route}`;

    if (!result.has(key)) {
      result.set(key, []);
    }

    result.get(key).push(transaction);
    return result;
  }, new Map());

  const endpoints = [...grouped.values()]
    .map((items) => {
      const latest = items[0];
      const summary = summarizeTransactions(items);

      return {
        endpointId: getEndpointKey(latest),
        method: latest.method,
        route: latest.route,
        environment: latest.environment,
        latestSeen: latest.occurredAt,
        slowRequestCount: items.filter(
          (transaction) => transaction.durationMs >= slowThresholdMs,
        ).length,
        ...summary,
      };
    })
    .sort((left, right) => right.p95DurationMs - left.p95DurationMs);

  return res.status(200).json({
    success: true,
    data: {
      endpoints,
      sampledTransactions: transactions.length,
      defaultWindowDays: DEFAULT_PERFORMANCE_DAYS,
    },
  });
});

const getEndpointPerformance = asyncHandler(async (req, res) => {
  const endpoint = parseEndpointKey(req.params.endpointId);
  const filter = {
    ...buildPerformanceFilter({
      query: req.query,
      organizationId: req.user.organizationId,
    }),
    method: endpoint.method,
    route: endpoint.route,
  };

  // spans excluded here too (summary doesn't read them, and the
  // slowest/recent lists below serialize with includeSpans: false) - see
  // the P1 fix note on serializeTransaction.
  const transactions = await PerformanceTransaction.find(filter)
    .select("-spans")
    .sort({ occurredAt: -1 })
    .limit(MAX_PERFORMANCE_ROWS)
    .lean();

  const slowest = [...transactions]
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 10)
    .map((transaction) => serializeTransaction(transaction, { includeSpans: false }));

  return res.status(200).json({
    success: true,
    data: {
      endpoint: {
        endpointId: req.params.endpointId,
        method: endpoint.method,
        route: endpoint.route,
      },
      summary: summarizeTransactions(transactions),
      slowestTransactions: slowest,
      recentTransactions: transactions
        .slice(0, 20)
        .map((transaction) => serializeTransaction(transaction, { includeSpans: false })),
    },
  });
});

const getEndpointTrends = asyncHandler(async (req, res) => {
  const endpoint = parseEndpointKey(req.params.endpointId);
  const filter = {
    ...buildPerformanceFilter({
      query: req.query,
      organizationId: req.user.organizationId,
    }),
    method: endpoint.method,
    route: endpoint.route,
  };

  // Pure aggregate endpoint (day buckets of summarizeTransactions output) -
  // spans/tags never read here either.
  const transactions = await PerformanceTransaction.find(filter)
    .select("-spans -tags")
    .sort({ occurredAt: 1 })
    .limit(MAX_PERFORMANCE_ROWS)
    .lean();

  const buckets = transactions.reduce((result, transaction) => {
    const bucket = transaction.occurredAt.toISOString().slice(0, 10);

    if (!result.has(bucket)) {
      result.set(bucket, []);
    }

    result.get(bucket).push(transaction);
    return result;
  }, new Map());

  const trend = [...buckets.entries()].map(([bucket, items]) => ({
    bucket,
    ...summarizeTransactions(items),
  }));

  const previous = trend.at(-2);
  const current = trend.at(-1);
  const averageDeltaMs =
    previous && current
      ? roundMetric(current.averageDurationMs - previous.averageDurationMs)
      : 0;
  const averageDeltaPercent =
    previous && current && previous.averageDurationMs
      ? roundMetric((averageDeltaMs / previous.averageDurationMs) * 100)
      : 0;

  return res.status(200).json({
    success: true,
    data: {
      endpoint: {
        endpointId: req.params.endpointId,
        method: endpoint.method,
        route: endpoint.route,
      },
      trend,
      comparison: {
        previousBucket: previous?.bucket || null,
        currentBucket: current?.bucket || null,
        previousAverageDurationMs: previous?.averageDurationMs || 0,
        currentAverageDurationMs: current?.averageDurationMs || 0,
        averageDeltaMs,
        averageDeltaPercent,
        regression: averageDeltaPercent > 0,
      },
    },
  });
});

const getTrace = asyncHandler(async (req, res) => {
  const filter = {
    ...buildPerformanceFilter({
      query: req.query,
      organizationId: req.user.organizationId,
    }),
    traceId: req.params.traceId,
  };

  const transactions = await PerformanceTransaction.find(filter)
    .sort({ occurredAt: 1 })
    .limit(100)
    .lean();

  return res.status(200).json({
    success: true,
    data: {
      traceId: req.params.traceId,
      transactions: transactions.map(serializeTransaction),
    },
  });
});

module.exports = {
  getEndpointPerformance,
  getEndpointTrends,
  getIssue,
  getTrace,
  listIssueEvents,
  listIssues,
  listPerformanceEndpoints,
  updateIssueStatus,
};
