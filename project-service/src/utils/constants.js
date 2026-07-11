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
  PROJECT_CREATE: "project:create",
  PROJECT_VIEW: "project:view",
  PROJECT_UPDATE: "project:update",
  PROJECT_DELETE: "project:delete",
});

const ProjectStatus = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
});

const ProjectEnvironments = Object.freeze({
  DEVELOPMENT: "development",
  STAGING: "staging",
  PRODUCTION: "production",
});

const DefaultEnvironment = ProjectEnvironments.PRODUCTION;

const QueueConfig = Object.freeze({
  EXCHANGE_NAME: process.env.RABBITMQ_EXCHANGE || "crashlens.events",
  RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://localhost:5672",
  // Terminal holding queue for project lifecycle events that failed to
  // publish even after MAX_RETRY_ATTEMPTS - mirrors the DLQ naming/role
  // worker-service and issue-service already use, so the same monitoring/
  // replay tooling conventions apply.
  DLQ: process.env.PROJECT_EVENTS_DLQ || "project-service.events.dlq",
  MAX_RETRY_ATTEMPTS: Number.parseInt(
    process.env.MAX_RETRY_ATTEMPTS || "3",
    10,
  ),
  RETRY_DELAY_MS: Number.parseInt(
    process.env.PROJECT_EVENTS_RETRY_DELAY_MS || "500",
    10,
  ),
  // DLQ entries carry dsnPublicKey (a bearer credential for event
  // ingestion, per event-service's DSN check) in plaintext - bound how long
  // a failed-publish event sits there instead of letting it accumulate
  // forever, same reasoning as the DsnCache TTL fallback from Module 1.
  // Expired messages are just dropped (no dead-letter-exchange configured
  // on this queue) - this is a terminal holding queue for manual triage,
  // not something that should auto-redeliver on expiry.
  DLQ_MESSAGE_TTL_MS: Number.parseInt(
    process.env.PROJECT_EVENTS_DLQ_TTL_MS || `${30 * 24 * 60 * 60 * 1000}`,
    10,
  ),
});

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "accesstoken",
  "refreshtoken",
  "token",
  "dsn",
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
  ProjectStatus,
  ProjectEnvironments,
  DefaultEnvironment,
  QueueConfig,
  ApiError,
  asyncHandler,
  slugify,
  redactSensitiveFields,
};
