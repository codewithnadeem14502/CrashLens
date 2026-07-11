const { UptimeMonitor, UptimeCheck } = require("../models/uptime-model");
const { ApiError, asyncHandler, slugify } = require("../utils/constants");
const { assertPublicUrl } = require("../utils/ssrfGuard");
const logger = require("../utils/logger");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const parsePagination = (query) => {
  const page = Number.parseInt(query.page || "1", 10);
  const limit = Math.min(Number.parseInt(query.limit || `${DEFAULT_LIMIT}`, 10), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
};

const sanitizeUptimeMonitor = (monitor) => ({
  id: monitor._id,
  projectId: monitor.projectId,
  organizationId: monitor.organizationId,
  name: monitor.name,
  slug: monitor.slug,
  url: monitor.url,
  method: monitor.method,
  headers: monitor.headers,
  intervalSeconds: monitor.intervalSeconds,
  timeoutMs: monitor.timeoutMs,
  expectedStatusMin: monitor.expectedStatusMin,
  expectedStatusMax: monitor.expectedStatusMax,
  consecutiveFailureThreshold: monitor.consecutiveFailureThreshold,
  environment: monitor.environment,
  status: monitor.status,
  consecutiveFailures: monitor.consecutiveFailures,
  lastCheckedAt: monitor.lastCheckedAt,
  lastStatus: monitor.lastStatus,
  createdAt: monitor.createdAt,
  updatedAt: monitor.updatedAt,
});

const sanitizeUptimeCheck = (check) => ({
  id: check._id,
  uptimeMonitorId: check.uptimeMonitorId,
  status: check.status,
  statusCode: check.statusCode,
  responseTimeMs: check.responseTimeMs,
  error: check.error,
  checkedAt: check.checkedAt,
});

const findUptimeMonitorForRequest = async ({ uptimeMonitorId, organizationId }) => {
  const monitor = await UptimeMonitor.findOne({ _id: uptimeMonitorId, organizationId });

  if (!monitor) {
    throw new ApiError(404, "Uptime monitor not found");
  }

  return monitor;
};

const assertValidStatusRange = ({ expectedStatusMin, expectedStatusMax }) => {
  if (
    expectedStatusMin !== undefined &&
    expectedStatusMax !== undefined &&
    expectedStatusMin > expectedStatusMax
  ) {
    throw new ApiError(400, "expectedStatusMin cannot be greater than expectedStatusMax");
  }
};

const createUptimeMonitor = asyncHandler(async (req, res) => {
  const organizationId = req.user.organizationId;
  const createdBy = req.user.sub;
  const { projectId, name } = req.body;

  assertValidStatusRange(req.body);
  assertPublicUrl(req.body.url);

  const slug = slugify(name);
  const existing = await UptimeMonitor.findOne({ organizationId, projectId, slug }).lean();

  if (existing) {
    throw new ApiError(409, "An uptime monitor with this name already exists for this project");
  }

  const monitor = await UptimeMonitor.create({
    ...req.body,
    organizationId,
    slug,
    createdBy,
    // nextProbeAt defaults to "now" at the schema level (see
    // models/uptime-model.js), so it's due on the first prober tick.
  });

  logger.info(`Created uptime monitor ${monitor._id} for project ${projectId} by user ${createdBy}`);

  return res.status(201).json({
    success: true,
    message: "Uptime monitor created successfully",
    data: { uptimeMonitor: sanitizeUptimeMonitor(monitor) },
  });
});

const listUptimeMonitors = asyncHandler(async (req, res) => {
  const filter = { organizationId: req.user.organizationId };

  if (req.query.projectId) {
    filter.projectId = req.query.projectId;
  }

  if (req.query.status) {
    filter.status = req.query.status;
  }

  const { page, limit, skip } = parsePagination(req.query);

  const [monitors, total] = await Promise.all([
    UptimeMonitor.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    UptimeMonitor.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      uptimeMonitors: monitors.map(sanitizeUptimeMonitor),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

const getUptimeMonitor = asyncHandler(async (req, res) => {
  const monitor = await findUptimeMonitorForRequest({
    uptimeMonitorId: req.params.uptimeMonitorId,
    organizationId: req.user.organizationId,
  });

  return res.status(200).json({
    success: true,
    data: { uptimeMonitor: sanitizeUptimeMonitor(monitor) },
  });
});

const updateUptimeMonitor = asyncHandler(async (req, res) => {
  const monitor = await findUptimeMonitorForRequest({
    uptimeMonitorId: req.params.uptimeMonitorId,
    organizationId: req.user.organizationId,
  });

  const merged = {
    expectedStatusMin: monitor.expectedStatusMin,
    expectedStatusMax: monitor.expectedStatusMax,
    ...req.body,
  };
  assertValidStatusRange(merged);

  if (req.body.url !== undefined) {
    assertPublicUrl(req.body.url);
  }

  const fields = [
    "name",
    "status",
    "url",
    "method",
    "headers",
    "body",
    "intervalSeconds",
    "timeoutMs",
    "expectedStatusMin",
    "expectedStatusMax",
    "consecutiveFailureThreshold",
    "environment",
  ];

  fields.forEach((field) => {
    if (req.body[field] !== undefined) {
      monitor[field] = req.body[field];
    }
  });

  if (req.body.name !== undefined) {
    monitor.slug = slugify(monitor.name);
  }

  // A changed interval invalidates whatever nextProbeAt was computed under
  // the old cadence - recompute from now so the prober picks up the new
  // interval on its next tick instead of waiting out the stale one.
  if (req.body.intervalSeconds !== undefined) {
    monitor.nextProbeAt = new Date();
  }

  await monitor.save();

  logger.info(`Updated uptime monitor ${monitor._id} by user ${req.user.sub}`);

  return res.status(200).json({
    success: true,
    message: "Uptime monitor updated successfully",
    data: { uptimeMonitor: sanitizeUptimeMonitor(monitor) },
  });
});

const deleteUptimeMonitor = asyncHandler(async (req, res) => {
  const monitor = await findUptimeMonitorForRequest({
    uptimeMonitorId: req.params.uptimeMonitorId,
    organizationId: req.user.organizationId,
  });

  await UptimeCheck.deleteMany({ uptimeMonitorId: monitor._id });
  await monitor.deleteOne();

  logger.info(`Deleted uptime monitor ${monitor._id} by user ${req.user.sub}`);

  return res.status(200).json({
    success: true,
    message: "Uptime monitor deleted successfully",
  });
});

const listChecks = asyncHandler(async (req, res) => {
  const monitor = await findUptimeMonitorForRequest({
    uptimeMonitorId: req.params.uptimeMonitorId,
    organizationId: req.user.organizationId,
  });

  const { page, limit, skip } = parsePagination(req.query);
  const filter = { uptimeMonitorId: monitor._id };

  const [checks, total] = await Promise.all([
    UptimeCheck.find(filter).sort({ checkedAt: -1 }).skip(skip).limit(limit).lean(),
    UptimeCheck.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      checks: checks.map(sanitizeUptimeCheck),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

module.exports = {
  createUptimeMonitor,
  listUptimeMonitors,
  getUptimeMonitor,
  updateUptimeMonitor,
  deleteUptimeMonitor,
  listChecks,
  sanitizeUptimeMonitor,
  sanitizeUptimeCheck,
};
