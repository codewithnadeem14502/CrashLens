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
  PROJECT_VIEW: "project:view",
  ISSUE_VIEW: "issue:view",
  ISSUE_UPDATE: "issue:update",
});

const IssueStatus = Object.freeze({
  UNRESOLVED: "unresolved",
  RESOLVED: "resolved",
  IGNORED: "ignored",
});

const Environments = Object.freeze({
  DEVELOPMENT: "development",
  STAGING: "staging",
  PRODUCTION: "production",
});

const Severity = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

const ProcessingStatus = Object.freeze({
  PROCESSING: "processing",
  PROCESSED: "processed",
  FAILED: "failed",
});

// Must match event-service's utils/constants.js LogLevels - both ends agree
// on the same allowed set, the same convention already established between
// the two services' Environments enums.
const LogLevel = Object.freeze({
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  FATAL: "fatal",
});

const EventTypes = Object.freeze({
  ISSUE_OCCURRENCE_DETECTED: "issue.occurrence.detected",
  TRANSACTION_INGESTED: "transaction.ingested",
  LOGS_INGESTED: "logs.ingested",
});

const QueueConfig = Object.freeze({
  EXCHANGE_NAME: process.env.RABBITMQ_EXCHANGE || "crashlens.events",
  RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://localhost:5672",
  OCCURRENCE_QUEUE:
    process.env.ISSUE_OCCURRENCE_QUEUE ||
    "issue-service.occurrence-processing",
  RETRY_QUEUE:
    process.env.ISSUE_OCCURRENCE_RETRY_QUEUE ||
    "issue-service.occurrence-processing.retry",
  DLQ:
    process.env.ISSUE_OCCURRENCE_DLQ ||
    "issue-service.occurrence-processing.dlq",
  TRANSACTION_QUEUE:
    process.env.ISSUE_TRANSACTION_QUEUE ||
    "issue-service.transaction-processing",
  TRANSACTION_RETRY_QUEUE:
    process.env.ISSUE_TRANSACTION_RETRY_QUEUE ||
    "issue-service.transaction-processing.retry",
  TRANSACTION_DLQ:
    process.env.ISSUE_TRANSACTION_DLQ ||
    "issue-service.transaction-processing.dlq",
  PREFETCH: Number.parseInt(process.env.ISSUE_PREFETCH || "10", 10),
  MAX_RETRY_ATTEMPTS: Number.parseInt(
    process.env.MAX_RETRY_ATTEMPTS || "3",
    10,
  ),
  RETRY_DELAY_MS: Number.parseInt(
    process.env.ISSUE_RETRY_DELAY_MS || "30000",
    10,
  ),
  // TRANSACTION_DLQ entries can carry span `data`/`tags` (redacted and
  // size-capped by the SDK and the Mongoose model, but not by anything on
  // this queue itself) - previously no TTL at all (unlike project-service's
  // DLQ, see crasLens-backend/.claude/CLAUDE.md), and Module 6's own
  // size/length caps mean a legitimately-oversized-but-otherwise-valid
  // transaction now deterministically lands here instead of being silently
  // persisted in full, so this queue needed the same bounded-retention
  // treatment project-service's DLQ already has.
  TRANSACTION_DLQ_TTL_MS: Number.parseInt(
    process.env.ISSUE_TRANSACTION_DLQ_TTL_MS || `${30 * 24 * 60 * 60 * 1000}`,
    10,
  ),
  LOG_QUEUE:
    process.env.ISSUE_LOG_QUEUE || "issue-service.log-processing",
  LOG_RETRY_QUEUE:
    process.env.ISSUE_LOG_RETRY_QUEUE || "issue-service.log-processing.retry",
  LOG_DLQ: process.env.ISSUE_LOG_DLQ || "issue-service.log-processing.dlq",
  // Same bounded-retention reasoning as TRANSACTION_DLQ_TTL_MS above - a
  // DLQ'd log batch can carry the same shape of context data a span's
  // `data` can, and logs are the highest-volume ingestion type, so a
  // shortest-not-longest TTL default rather than reusing the transaction
  // one verbatim would be the more conservative choice; keeping it at the
  // same 30-day default for now for consistency across every DLQ in this
  // codebase (DsnCache TTL, ProcessedOccurrence TTL, TRANSACTION_DLQ TTL
  // all use the same 30-day figure) - tune independently via env if a
  // deployment needs this one shorter.
  LOG_DLQ_TTL_MS: Number.parseInt(
    process.env.ISSUE_LOG_DLQ_TTL_MS || `${30 * 24 * 60 * 60 * 1000}`,
    10,
  ),
});

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "passwordhash",
  "accesstoken",
  "refreshtoken",
  "token",
  "dsn",
  "dsnpublickey",
]);

class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
    this.isPoison = true;
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
  ApiError,
  Environments,
  EventTypes,
  IssueStatus,
  Level,
  LogLevel,
  NodeEnv,
  Permissions,
  ProcessingStatus,
  QueueConfig,
  Roles,
  Severity,
  ValidationError,
  asyncHandler,
  redactSensitiveFields,
};
