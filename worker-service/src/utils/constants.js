const Level = Object.freeze({
  INFO: "info",
  DEBUG: "debug",
});

const NodeEnv = Object.freeze({
  PRODUCTION: "production",
  DEVELOPMENT: "development",
});

const EventTypes = Object.freeze({
  EVENT_INGESTED: "event.ingested",
  ISSUE_OCCURRENCE_DETECTED: "issue.occurrence.detected",
});

const Producers = Object.freeze({
  EVENT_SERVICE: "event-service",
  WORKER_SERVICE: "worker-service",
});

const Environments = Object.freeze({
  DEVELOPMENT: "development",
  STAGING: "staging",
  PRODUCTION: "production",
});

const EventKinds = Object.freeze({
  EXCEPTION: "exception",
  MESSAGE: "message",
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

const QueueConfig = Object.freeze({
  EXCHANGE_NAME: process.env.RABBITMQ_EXCHANGE || "crashlens.events",
  RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://localhost:5672",
  EVENT_QUEUE:
    process.env.WORKER_EVENT_QUEUE || "worker-service.event-ingestion",
  RETRY_QUEUE:
    process.env.WORKER_EVENT_RETRY_QUEUE ||
    "worker-service.event-ingestion.retry",
  DLQ: process.env.WORKER_EVENT_DLQ || "worker-service.event-ingestion.dlq",
  PREFETCH: Number.parseInt(process.env.WORKER_PREFETCH || "10", 10),
  MAX_RETRY_ATTEMPTS: Number.parseInt(
    process.env.MAX_RETRY_ATTEMPTS || "3",
    10,
  ),
  RETRY_DELAY_MS: Number.parseInt(
    process.env.WORKER_RETRY_DELAY_MS || "30000",
    10,
  ),
});

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "dsn",
  "dsnpublickey",
  "password",
  "passwordhash",
  "refreshtoken",
  "token",
  "accesstoken",
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
  EventKinds,
  EventTypes,
  Level,
  NodeEnv,
  ProcessingStatus,
  Producers,
  QueueConfig,
  Severity,
  ValidationError,
  asyncHandler,
  redactSensitiveFields,
};
