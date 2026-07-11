const Level = Object.freeze({
  INFO: "info",
  DEBUG: "debug",
});

const NodeEnv = Object.freeze({
  PRODUCTION: "production",
  DEVELOPMENT: "development",
});

const Roles = Object.freeze({
  ADMIN: "admin",
  DEVELOPER: "developer",
  VIEWER: "viewer",
});

// Already defined and granted in auth-service/src/utils/constants.js's
// RolePermissions (ALERT_VIEW to all roles, ALERT_MANAGE to admin only) -
// this module is the first to actually consume them.
const Permissions = Object.freeze({
  ALERT_VIEW: "alert:view",
  ALERT_MANAGE: "alert:manage",
});

const Environments = Object.freeze({
  DEVELOPMENT: "development",
  STAGING: "staging",
  PRODUCTION: "production",
});

// Datasets the generic query executor can read. Each maps to an existing
// issue-service/monitor-service HTTP endpoint - see query/service-client.js.
// No new storage is introduced here; this only names what's queryable.
const Dataset = Object.freeze({
  ISSUES: "issues",
  TRANSACTIONS: "transactions",
  LOGS: "logs",
  MONITORS: "monitors",
  UPTIME_MONITORS: "uptimeMonitors",
});

// Which aggregates are meaningful for which dataset (enforced in
// query/query-executor.js). COUNT is universal; the duration/error-rate
// aggregates only make sense against transactions, which is the only
// dataset carrying a duration/status-code field.
const Aggregate = Object.freeze({
  COUNT: "count",
  AVG_DURATION_MS: "avg_duration_ms",
  P95_DURATION_MS: "p95_duration_ms",
  ERROR_RATE: "error_rate",
});

const DATASET_AGGREGATES = Object.freeze({
  [Dataset.ISSUES]: [Aggregate.COUNT],
  [Dataset.LOGS]: [Aggregate.COUNT],
  [Dataset.MONITORS]: [Aggregate.COUNT],
  [Dataset.UPTIME_MONITORS]: [Aggregate.COUNT],
  [Dataset.TRANSACTIONS]: [
    Aggregate.COUNT,
    Aggregate.AVG_DURATION_MS,
    Aggregate.P95_DURATION_MS,
    Aggregate.ERROR_RATE,
  ],
});

const ThresholdType = Object.freeze({
  STATIC: "static",
  PERCENT_CHANGE: "percent_change",
});

// "above": alert fires when value >= threshold (e.g. error rate, p95
// latency, missed-checkin count). "below": alert fires when value <=
// threshold (e.g. a successful-request count dropping). Applies uniformly
// to warning/critical/resolve thresholds and, for percent_change rules, to
// the computed percent-change value itself.
const ThresholdDirection = Object.freeze({
  ABOVE: "above",
  BELOW: "below",
});

// Ordered severity - index doubles as a numeric level for comparison in the
// evaluation engine's state machine (jobs/alert-evaluator.js).
const AlertState = Object.freeze({
  OK: "ok",
  WARNING: "warning",
  CRITICAL: "critical",
});

const AlertStateRank = Object.freeze({
  [AlertState.OK]: 0,
  [AlertState.WARNING]: 1,
  [AlertState.CRITICAL]: 2,
});

const RuleStatus = Object.freeze({
  ACTIVE: "active",
  PAUSED: "paused",
});

const NotificationActionType = Object.freeze({
  EMAIL: "email",
  WEBHOOK: "webhook",
});

const NotificationDeliveryStatus = Object.freeze({
  SENT: "sent",
  FAILED: "failed",
});

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "accesstoken",
  "refreshtoken",
  "token",
  "checktoken",
  "authorization",
  "cookie",
  "smtppass",
]);

class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const redactSensitiveFields = (value) => {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveFields);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.entries(value).reduce((result, [key, fieldValue]) => {
    result[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? "[REDACTED]"
      : redactSensitiveFields(fieldValue);

    return result;
  }, {});
};

module.exports = {
  Level,
  NodeEnv,
  Roles,
  Permissions,
  Environments,
  Dataset,
  Aggregate,
  DATASET_AGGREGATES,
  ThresholdType,
  ThresholdDirection,
  AlertState,
  AlertStateRank,
  RuleStatus,
  NotificationActionType,
  NotificationDeliveryStatus,
  ApiError,
  asyncHandler,
  redactSensitiveFields,
};
