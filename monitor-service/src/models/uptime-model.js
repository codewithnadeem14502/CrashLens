const mongoose = require("mongoose");
const {
  DefaultEnvironment,
  Environments,
  MonitorStatus,
  UptimeStatus,
} = require("../utils/constants");

const UPTIME_CHECK_TTL_SECONDS = Number.parseInt(
  process.env.UPTIME_CHECK_TTL_SECONDS || `${90 * 24 * 60 * 60}`,
  10,
);

const uptimeMonitorSchema = new mongoose.Schema(
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
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
    },
    method: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 10,
      default: "GET",
    },
    // Mixed, not further capped here - request headers a user configures
    // for their own probe target aren't attacker-controlled input the way
    // ingestion payloads are (only an authenticated MONITOR_MANAGE user can
    // set this), but redactSensitiveFields still applies wherever this gets
    // logged (see app.js's request-logging middleware).
    headers: mongoose.Schema.Types.Mixed,
    body: {
      type: String,
      maxlength: 4000,
    },
    intervalSeconds: {
      type: Number,
      min: 30,
      default: 60,
    },
    timeoutMs: {
      type: Number,
      min: 1000,
      max: 30000,
      default: 10000,
    },
    expectedStatusMin: {
      type: Number,
      min: 100,
      max: 599,
      default: 200,
    },
    expectedStatusMax: {
      type: Number,
      min: 100,
      max: 599,
      default: 299,
    },
    consecutiveFailureThreshold: {
      type: Number,
      min: 1,
      default: 3,
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
    consecutiveFailures: {
      type: Number,
      min: 0,
      default: 0,
    },
    lastCheckedAt: {
      type: Date,
      index: true,
    },
    // Precomputed at creation and after every probe (lastCheckedAt +
    // intervalSeconds), mirroring Monitor's nextExpectedAt pattern - lets
    // the prober's due-query be a plain indexed range comparison
    // ({status, nextProbeAt: {$lte: now}}) instead of the $expr-based
    // {$add: [lastCheckedAt, {$multiply: [intervalSeconds, 1000]}]}
    // comparison it used before, which couldn't use an index for the
    // actual due-check (backend review finding, Module 8: the collection
    // also had no compound index at all matching the prober's query shape
    // before this).
    nextProbeAt: {
      type: Date,
      // Defaults to "now" so any creation path (not just the controller)
      // is immediately due on the first prober tick, matching the old
      // lastCheckedAt:null "never probed yet" semantic.
      default: Date.now,
      index: true,
    },
    lastStatus: {
      type: String,
      enum: Object.values(UptimeStatus),
      default: UptimeStatus.UNKNOWN,
    },
    // True once consecutiveFailures has crossed consecutiveFailureThreshold
    // AND an occurrence has already been published for this run of
    // failures - prevents publishing a fresh Issue occurrence on every
    // single failed probe past the threshold (which would spam the Issue
    // with an occurrence every intervalSeconds). Reset to false on the next
    // successful probe, so a *future* run of failures re-publishes (see
    // jobs/uptime-prober.js).
    incidentOpen: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
  },
  { timestamps: true },
);

uptimeMonitorSchema.index({ organizationId: 1, projectId: 1, slug: 1 }, { unique: true });
// Matches the prober's actual query shape - see jobs/uptime-prober.js.
uptimeMonitorSchema.index({ status: 1, nextProbeAt: 1 });

const uptimeCheckSchema = new mongoose.Schema(
  {
    uptimeMonitorId: {
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
      enum: [UptimeStatus.UP, UptimeStatus.DOWN],
      required: true,
      index: true,
    },
    statusCode: Number,
    responseTimeMs: {
      type: Number,
      min: 0,
    },
    error: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    checkedAt: {
      type: Date,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + UPTIME_CHECK_TTL_SECONDS * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

uptimeCheckSchema.index({ uptimeMonitorId: 1, checkedAt: -1 });

const UptimeMonitor = mongoose.model("UptimeMonitor", uptimeMonitorSchema);
const UptimeCheck = mongoose.model("UptimeCheck", uptimeCheckSchema);

module.exports = {
  UptimeMonitor,
  UptimeCheck,
  UPTIME_CHECK_TTL_SECONDS,
};
