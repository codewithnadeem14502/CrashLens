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

const EventTypes = Object.freeze({
  ISSUE_OCCURRENCE_DETECTED: "issue.occurrence.detected",
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
  PREFETCH: Number.parseInt(process.env.ISSUE_PREFETCH || "10", 10),
  MAX_RETRY_ATTEMPTS: Number.parseInt(
    process.env.MAX_RETRY_ATTEMPTS || "3",
    10,
  ),
  RETRY_DELAY_MS: Number.parseInt(
    process.env.ISSUE_RETRY_DELAY_MS || "30000",
    10,
  ),
});

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "passwordHash",
  "accessToken",
  "refreshToken",
  "token",
  "dsn",
  "dsnPublicKey",
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
    result[key] = SENSITIVE_KEYS.has(key)
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
