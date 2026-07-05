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

const DefaultEnvironment = "production";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "accessToken",
  "refreshToken",
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
    result[key] = SENSITIVE_KEYS.has(key)
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
  DefaultEnvironment,
  ApiError,
  asyncHandler,
  slugify,
  redactSensitiveFields,
};
