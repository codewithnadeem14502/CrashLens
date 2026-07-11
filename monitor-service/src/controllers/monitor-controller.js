const crypto = require("crypto");
const mongoose = require("mongoose");
const { Monitor, CheckIn, generateCheckToken } = require("../models/monitor-model");
const { computeNextExpectedAt } = require("../utils/schedule");
const {
  ApiError,
  CheckInStatus,
  MonitorStatus,
  ScheduleType,
  asyncHandler,
  slugify,
} = require("../utils/constants");
const logger = require("../utils/logger");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const parsePagination = (query) => {
  const page = Number.parseInt(query.page || "1", 10);
  const limit = Math.min(Number.parseInt(query.limit || `${DEFAULT_LIMIT}`, 10), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
};

const sanitizeMonitor = (monitor) => ({
  id: monitor._id,
  projectId: monitor.projectId,
  organizationId: monitor.organizationId,
  name: monitor.name,
  slug: monitor.slug,
  scheduleType: monitor.scheduleType,
  crontab: monitor.crontab,
  intervalSeconds: monitor.intervalSeconds,
  timezone: monitor.timezone,
  checkinMarginSeconds: monitor.checkinMarginSeconds,
  maxRuntimeSeconds: monitor.maxRuntimeSeconds,
  environment: monitor.environment,
  status: monitor.status,
  nextExpectedAt: monitor.nextExpectedAt,
  lastCheckInAt: monitor.lastCheckInAt,
  lastCheckInStatus: monitor.lastCheckInStatus,
  createdBy: monitor.createdBy,
  createdAt: monitor.createdAt,
  updatedAt: monitor.updatedAt,
});

const sanitizeCheckIn = (checkIn) => ({
  id: checkIn._id,
  monitorId: checkIn.monitorId,
  status: checkIn.status,
  startedAt: checkIn.startedAt,
  finishedAt: checkIn.finishedAt,
  durationMs: checkIn.durationMs,
  message: checkIn.message,
  createdAt: checkIn.createdAt,
});

// Validates the schedule fields are internally consistent for whichever
// scheduleType the document will end up with after this write - runs
// against the merged (existing + incoming) shape so a PATCH that only
// touches one of the two fields can't leave the pair inconsistent (e.g.
// switching scheduleType to "interval" without ever supplying
// intervalSeconds, which would silently break computeNextExpectedAt).
const assertValidSchedule = ({ scheduleType, crontab, intervalSeconds, timezone }) => {
  if (scheduleType === ScheduleType.CRONTAB && !crontab) {
    throw new ApiError(400, "crontab is required when scheduleType is crontab");
  }

  if (scheduleType === ScheduleType.INTERVAL && !intervalSeconds) {
    throw new ApiError(400, "intervalSeconds is required when scheduleType is interval");
  }

  if (scheduleType === ScheduleType.CRONTAB) {
    // Throws ApiError(400) itself on an invalid expression.
    computeNextExpectedAt({ scheduleType, crontab, timezone }, new Date());
  }
};

const findMonitorForRequest = async ({ monitorId, organizationId, withToken = false }) => {
  const query = Monitor.findOne({ _id: monitorId, organizationId });

  if (withToken) {
    query.select("+checkToken");
  }

  const monitor = await query;

  if (!monitor) {
    throw new ApiError(404, "Monitor not found");
  }

  return monitor;
};

const createMonitor = asyncHandler(async (req, res) => {
  const organizationId = req.user.organizationId;
  const createdBy = req.user.sub;
  const {
    projectId,
    name,
    scheduleType,
    crontab,
    intervalSeconds,
    timezone,
    checkinMarginSeconds,
    maxRuntimeSeconds,
    environment,
  } = req.body;

  assertValidSchedule({ scheduleType, crontab, intervalSeconds, timezone });

  const slug = slugify(name);
  const existing = await Monitor.findOne({ organizationId, projectId, slug }).lean();

  if (existing) {
    throw new ApiError(409, "A monitor with this name already exists for this project");
  }

  const checkToken = generateCheckToken();
  const nextExpectedAt = computeNextExpectedAt(
    { scheduleType, crontab, intervalSeconds, timezone },
    new Date(),
  );

  const monitor = await Monitor.create({
    projectId,
    organizationId,
    name,
    slug,
    scheduleType,
    crontab,
    intervalSeconds,
    timezone,
    checkinMarginSeconds,
    maxRuntimeSeconds,
    environment,
    checkToken,
    nextExpectedAt,
    createdBy,
  });

  logger.info(`Created monitor ${monitor._id} for project ${projectId} by user ${createdBy}`);

  return res.status(201).json({
    success: true,
    message: "Monitor created successfully",
    data: {
      monitor: sanitizeMonitor(monitor),
      // Only ever returned here and from regenerateCheckToken - same
      // one-time-visible convention as a project's DSN.
      checkToken,
    },
  });
});

const listMonitors = asyncHandler(async (req, res) => {
  const filter = { organizationId: req.user.organizationId };

  if (req.query.projectId) {
    filter.projectId = req.query.projectId;
  }

  if (req.query.status) {
    filter.status = req.query.status;
  }

  const { page, limit, skip } = parsePagination(req.query);

  const [monitors, total] = await Promise.all([
    Monitor.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Monitor.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      monitors: monitors.map(sanitizeMonitor),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

const getMonitor = asyncHandler(async (req, res) => {
  const monitor = await findMonitorForRequest({
    monitorId: req.params.monitorId,
    organizationId: req.user.organizationId,
  });

  return res.status(200).json({
    success: true,
    data: { monitor: sanitizeMonitor(monitor) },
  });
});

const updateMonitor = asyncHandler(async (req, res) => {
  const monitor = await findMonitorForRequest({
    monitorId: req.params.monitorId,
    organizationId: req.user.organizationId,
  });

  const fields = [
    "name",
    "status",
    "scheduleType",
    "crontab",
    "intervalSeconds",
    "timezone",
    "checkinMarginSeconds",
    "maxRuntimeSeconds",
    "environment",
  ];
  const scheduleFieldsTouched = ["scheduleType", "crontab", "intervalSeconds", "timezone"].some(
    (field) => req.body[field] !== undefined,
  );

  fields.forEach((field) => {
    if (req.body[field] !== undefined) {
      monitor[field] = req.body[field];
    }
  });

  if (req.body.name !== undefined) {
    monitor.slug = slugify(monitor.name);
  }

  assertValidSchedule(monitor);

  if (scheduleFieldsTouched) {
    monitor.nextExpectedAt = computeNextExpectedAt(monitor, new Date());
  }

  await monitor.save();

  logger.info(`Updated monitor ${monitor._id} by user ${req.user.sub}`);

  return res.status(200).json({
    success: true,
    message: "Monitor updated successfully",
    data: { monitor: sanitizeMonitor(monitor) },
  });
});

const deleteMonitor = asyncHandler(async (req, res) => {
  const monitor = await findMonitorForRequest({
    monitorId: req.params.monitorId,
    organizationId: req.user.organizationId,
  });

  // Hard delete, not an archive-status like Project - check-in history has
  // no meaning without its parent monitor (unlike a project, which stays
  // useful as a historical record even archived). Deliberate minimal-scope
  // simplification.
  await CheckIn.deleteMany({ monitorId: monitor._id });
  await monitor.deleteOne();

  logger.info(`Deleted monitor ${monitor._id} by user ${req.user.sub}`);

  return res.status(200).json({
    success: true,
    message: "Monitor deleted successfully",
  });
});

const regenerateCheckToken = asyncHandler(async (req, res) => {
  const monitor = await findMonitorForRequest({
    monitorId: req.params.monitorId,
    organizationId: req.user.organizationId,
  });

  const checkToken = generateCheckToken();
  monitor.checkToken = checkToken;
  await monitor.save();

  logger.warn(`Regenerated check token for monitor ${monitor._id} by user ${req.user.sub}`);

  return res.status(200).json({
    success: true,
    message: "Check token regenerated successfully",
    data: { monitorId: monitor._id, checkToken },
  });
});

const listCheckIns = asyncHandler(async (req, res) => {
  const monitor = await findMonitorForRequest({
    monitorId: req.params.monitorId,
    organizationId: req.user.organizationId,
  });

  const { page, limit, skip } = parsePagination(req.query);
  const filter = { monitorId: monitor._id };

  const [checkIns, total] = await Promise.all([
    CheckIn.find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit).lean(),
    CheckIn.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      checkIns: checkIns.map(sanitizeCheckIn),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

// Constant-time comparison so a check-in ping can't be brute-forced by
// timing how long the comparison takes on a partial prefix match.
const tokensMatch = (provided, actual) => {
  const providedBuffer = Buffer.from(String(provided));
  const actualBuffer = Buffer.from(String(actual));

  if (providedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, actualBuffer);
};

const findMonitorByCheckToken = async ({ monitorId, token }) => {
  if (!mongoose.Types.ObjectId.isValid(monitorId)) {
    throw new ApiError(400, "monitorId is invalid");
  }

  const monitor = await Monitor.findById(monitorId).select("+checkToken");

  if (!monitor || !tokensMatch(token, monitor.checkToken)) {
    // Same 401 either way - don't let the response distinguish "no such
    // monitor" from "wrong token" (avoids leaking monitor existence to an
    // unauthenticated caller).
    throw new ApiError(401, "Invalid monitor or check token");
  }

  return monitor;
};

// Advances nextExpectedAt for BOTH "ok" and "error" outcomes, not just
// "ok" - an "error" check-in still means the job *ran and reported back*
// for this window (unlike a true miss, where nothing calls in at all). If
// this only advanced on "ok", an error check-in would correctly get
// recorded here but then the cron sweep would ALSO independently flag the
// same window as missed once checkinMarginSeconds passed, double-reporting
// one bad window as two separate incidents.
const advanceMonitorAfterCheckIn = async ({ monitor, status, checkedInAt }) => {
  monitor.lastCheckInAt = checkedInAt;
  monitor.lastCheckInStatus = status;
  monitor.nextExpectedAt = computeNextExpectedAt(monitor, checkedInAt);
  await monitor.save();
};

// Single-ping style (status: "ok"/"error" supplied directly) or two-step
// start style (status omitted/"in_progress", finished later via
// finishCheckIn) - both are common real-world cron-monitoring shapes
// (Healthchecks.io-style single ping vs. Sentry Crons-style start/finish),
// supporting both keeps this usable for the widest range of external job
// runners without forcing a specific integration shape.
const createCheckIn = asyncHandler(async (req, res) => {
  const monitor = await findMonitorByCheckToken({
    monitorId: req.params.monitorId,
    token: req.body.token,
  });

  const status = req.body.status || CheckInStatus.IN_PROGRESS;
  const now = new Date();

  if (status === CheckInStatus.IN_PROGRESS) {
    const timeoutAt = new Date(now.getTime() + monitor.maxRuntimeSeconds * 1000);
    const checkIn = await CheckIn.create({
      monitorId: monitor._id,
      projectId: monitor.projectId,
      organizationId: monitor.organizationId,
      status,
      startedAt: now,
      timeoutAt,
      message: req.body.message,
    });

    monitor.lastCheckInAt = now;
    monitor.lastCheckInStatus = status;
    await monitor.save();

    return res.status(201).json({
      success: true,
      message: "Check-in started",
      data: { checkIn: sanitizeCheckIn(checkIn) },
    });
  }

  const checkIn = await CheckIn.create({
    monitorId: monitor._id,
    projectId: monitor.projectId,
    organizationId: monitor.organizationId,
    status,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    message: req.body.message,
  });

  await advanceMonitorAfterCheckIn({ monitor, status, checkedInAt: now });

  return res.status(201).json({
    success: true,
    message: "Check-in recorded",
    data: { checkIn: sanitizeCheckIn(checkIn) },
  });
});

const finishCheckIn = asyncHandler(async (req, res) => {
  const monitor = await findMonitorByCheckToken({
    monitorId: req.params.monitorId,
    token: req.body.token,
  });

  const checkIn = await CheckIn.findOne({
    _id: req.params.checkinId,
    monitorId: monitor._id,
    status: CheckInStatus.IN_PROGRESS,
  });

  if (!checkIn) {
    throw new ApiError(404, "In-progress check-in not found");
  }

  const now = new Date();
  checkIn.status = req.body.status;
  checkIn.finishedAt = now;
  checkIn.durationMs = now.getTime() - checkIn.startedAt.getTime();

  if (req.body.message !== undefined) {
    checkIn.message = req.body.message;
  }

  await checkIn.save();
  await advanceMonitorAfterCheckIn({ monitor, status: checkIn.status, checkedInAt: now });

  return res.status(200).json({
    success: true,
    message: "Check-in finished",
    data: { checkIn: sanitizeCheckIn(checkIn) },
  });
});

module.exports = {
  createMonitor,
  listMonitors,
  getMonitor,
  updateMonitor,
  deleteMonitor,
  regenerateCheckToken,
  listCheckIns,
  createCheckIn,
  finishCheckIn,
  sanitizeMonitor,
  sanitizeCheckIn,
};
