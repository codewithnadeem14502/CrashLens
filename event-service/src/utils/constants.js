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

const EventTypes = Object.freeze({
  EVENT_INGESTED: "event.ingested",
  TRANSACTION_INGESTED: "transaction.ingested",
  LOGS_INGESTED: "logs.ingested",
});

const LogLevels = Object.freeze({
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  FATAL: "fatal",
});

// Synced to match issue-service's fuller SENSITIVE_KEYS list (Module 7
// review finding): this service's request-logging middleware redacts req.body
// before logging it, and Module 7's new `logs[].context` field is the first
// place a genuinely free-form, producer-controlled object flows through this
// exact code path at high volume - a caller putting an "authorization" or
// "cookie" key inside `context` would previously have logged in cleartext
// here even though the identical field name is already redacted by
// issue-service. Keep in sync with issue-service/src/utils/constants.js.
const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "accesstoken",
  "refreshtoken",
  "token",
  "dsn",
  "dsnpublickey",
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
  EventTypes,
  LogLevels,
  ApiError,
  asyncHandler,
  slugify,
  redactSensitiveFields,
};
