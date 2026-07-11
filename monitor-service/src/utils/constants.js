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

const Permissions = Object.freeze({
  MONITOR_VIEW: "monitor:view",
  MONITOR_MANAGE: "monitor:manage",
});

const Environments = Object.freeze({
  DEVELOPMENT: "development",
  STAGING: "staging",
  PRODUCTION: "production",
});

const DefaultEnvironment = Environments.PRODUCTION;

// Matches issue-service's Severity enum - occurrence events this service
// publishes must use one of these values (see events/occurrence-publisher.js).
const Severity = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

const ScheduleType = Object.freeze({
  CRONTAB: "crontab",
  INTERVAL: "interval",
});

const MonitorStatus = Object.freeze({
  ACTIVE: "active",
  PAUSED: "paused",
});

const CheckInStatus = Object.freeze({
  IN_PROGRESS: "in_progress",
  OK: "ok",
  ERROR: "error",
  MISSED: "missed",
  TIMEOUT: "timeout",
});

const UptimeStatus = Object.freeze({
  UP: "up",
  DOWN: "down",
  UNKNOWN: "unknown",
});

// Reuses issue-service's exact routing key/envelope shape
// (issue-service/src/events/issue-events.js's validateOccurrenceEnvelope) -
// monitor-service bypasses worker-service entirely (like transactions/logs
// already do) since a missed check-in or downed uptime check already has a
// natural, stable fingerprint and no stack trace to parse.
const EventTypes = Object.freeze({
  ISSUE_OCCURRENCE_DETECTED: "issue.occurrence.detected",
});

const QueueConfig = Object.freeze({
  EXCHANGE_NAME: process.env.RABBITMQ_EXCHANGE || "crashlens.events",
  RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://localhost:5672",
  // Terminal holding queue for occurrence events that failed to publish even
  // after MAX_RETRY_ATTEMPTS - mirrors project-service's events.dlq role.
  DLQ: process.env.MONITOR_EVENTS_DLQ || "monitor-service.events.dlq",
  MAX_RETRY_ATTEMPTS: Number.parseInt(process.env.MAX_RETRY_ATTEMPTS || "3", 10),
  RETRY_DELAY_MS: Number.parseInt(
    process.env.MONITOR_EVENTS_RETRY_DELAY_MS || "500",
    10,
  ),
  DLQ_MESSAGE_TTL_MS: Number.parseInt(
    process.env.MONITOR_EVENTS_DLQ_TTL_MS || `${30 * 24 * 60 * 60 * 1000}`,
    10,
  ),
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

const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const redactSensitiveFields = (value) => {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveFields);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.entries(value).reduce((result, [key, fieldValue]) => {
    // Lowercased before the Set lookup (security review finding): real
    // header names are almost always capitalized ("Authorization",
    // "Cookie"), and this is the first service where a user-supplied
    // header bag (UptimeMonitor.headers) - not a fixed, code-controlled
    // field name - flows through this function, so a case-sensitive match
    // would silently miss them.
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
  DefaultEnvironment,
  Severity,
  ScheduleType,
  MonitorStatus,
  CheckInStatus,
  UptimeStatus,
  EventTypes,
  QueueConfig,
  ApiError,
  asyncHandler,
  slugify,
  redactSensitiveFields,
};
