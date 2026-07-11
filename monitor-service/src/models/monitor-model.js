const crypto = require("crypto");
const mongoose = require("mongoose");
const {
  CheckInStatus,
  Environments,
  DefaultEnvironment,
  MonitorStatus,
  ScheduleType,
} = require("../utils/constants");

// Check-in history is naturally time-bounded and high volume for an active
// monitor (one row per expected window) - TTL from day one, same reasoning
// as the other high-volume collections in this codebase (LogEntry,
// ProcessedEvent/ProcessedOccurrence).
const CHECKIN_TTL_SECONDS = Number.parseInt(
  process.env.CHECKIN_TTL_SECONDS || `${90 * 24 * 60 * 60}`,
  10,
);

const monitorSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 200,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 140,
    },
    scheduleType: {
      type: String,
      enum: Object.values(ScheduleType),
      required: true,
    },
    crontab: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    intervalSeconds: {
      type: Number,
      min: 60,
    },
    timezone: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "UTC",
    },
    // Grace period after the expected check-in time before the sweep marks
    // a missed window - avoids flagging a monitor that's merely a few
    // seconds late as an incident.
    checkinMarginSeconds: {
      type: Number,
      min: 0,
      default: 300,
    },
    // Max allowed duration for an in_progress check-in before the sweep
    // marks it timeout - protects against a check-in that started but the
    // job hung/crashed without ever reporting back.
    maxRuntimeSeconds: {
      type: Number,
      min: 0,
      default: 3600,
    },
    environment: {
      type: String,
      enum: Object.values(Environments),
      default: DefaultEnvironment,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(MonitorStatus),
      default: MonitorStatus.ACTIVE,
      index: true,
    },
    // Per-monitor secret an external cron job's check-in ping must present
    // (see controllers/monitor-controller.js) - a deliberately narrower
    // credential than the project DSN: a leaked check-in token only lets
    // someone spoof check-ins for this one monitor, not ingest arbitrary
    // events for the whole project. Never exposed on list/get responses
    // except immediately after creation/regeneration (mirrors how a
    // project's DSN is select:false by default).
    checkToken: {
      type: String,
      required: true,
      select: false,
    },
    nextExpectedAt: {
      type: Date,
      index: true,
    },
    lastCheckInAt: Date,
    lastCheckInStatus: {
      type: String,
      enum: Object.values(CheckInStatus),
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
  },
  { timestamps: true },
);

monitorSchema.index({ organizationId: 1, projectId: 1, slug: 1 }, { unique: true });
// Matches the sweep's actual query shape (active monitors whose window has
// passed) - see jobs/cron-sweep.js.
monitorSchema.index({ status: 1, nextExpectedAt: 1 });

const generateCheckToken = () => crypto.randomBytes(24).toString("hex");

const checkInSchema = new mongoose.Schema(
  {
    monitorId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(CheckInStatus),
      required: true,
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    finishedAt: Date,
    durationMs: {
      type: Number,
      min: 0,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    // Pre-computed at check-in start (startedAt + monitor.maxRuntimeSeconds)
    // so the timeout sweep can query directly without joining back to the
    // Monitor document for every in_progress row on every tick.
    timeoutAt: {
      type: Date,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + CHECKIN_TTL_SECONDS * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

checkInSchema.index({ monitorId: 1, startedAt: -1 });
// Matches the timeout sweep's actual query shape - see jobs/cron-sweep.js.
checkInSchema.index({ status: 1, timeoutAt: 1 });

const Monitor = mongoose.model("Monitor", monitorSchema);
const CheckIn = mongoose.model("CheckIn", checkInSchema);

module.exports = {
  Monitor,
  CheckIn,
  generateCheckToken,
  CHECKIN_TTL_SECONDS,
};
