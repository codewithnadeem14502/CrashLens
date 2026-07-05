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
  ORGANIZATION_VIEW: "organization:view",
  PROJECT_CREATE: "project:create",
  PROJECT_VIEW: "project:view",
  PROJECT_UPDATE: "project:update",
  PROJECT_DELETE: "project:delete",
  MEMBER_VIEW: "member:view",
  MEMBER_INVITE: "member:invite",
  MEMBER_REMOVE: "member:remove",
  INTEGRATION_MANAGE: "integration:manage",
  ISSUE_VIEW: "issue:view",
  ISSUE_UPDATE: "issue:update",
  ALERT_VIEW: "alert:view",
  ALERT_MANAGE: "alert:manage",
});

const RolePermissions = Object.freeze({
  [Roles.ADMIN]: Object.freeze([
    Permissions.ORGANIZATION_VIEW,
    Permissions.PROJECT_CREATE,
    Permissions.PROJECT_VIEW,
    Permissions.PROJECT_UPDATE,
    Permissions.PROJECT_DELETE,
    Permissions.MEMBER_VIEW,
    Permissions.MEMBER_INVITE,
    Permissions.MEMBER_REMOVE,
    Permissions.INTEGRATION_MANAGE,
    Permissions.ISSUE_VIEW,
    Permissions.ISSUE_UPDATE,
    Permissions.ALERT_VIEW,
    Permissions.ALERT_MANAGE,
  ]),
  [Roles.DEVELOPER]: Object.freeze([
    Permissions.ORGANIZATION_VIEW,
    Permissions.PROJECT_VIEW,
    Permissions.MEMBER_VIEW,
    Permissions.ISSUE_VIEW,
    Permissions.ISSUE_UPDATE,
    Permissions.ALERT_VIEW,
  ]),
  [Roles.VIEWER]: Object.freeze([
    Permissions.ORGANIZATION_VIEW,
    Permissions.PROJECT_VIEW,
    Permissions.ISSUE_VIEW,
    Permissions.ALERT_VIEW,
  ]),
});

const AssignableMemberRoles = Object.freeze([
  Roles.DEVELOPER,
  Roles.VIEWER,
]);

const AccountStatus = Object.freeze({
  ACTIVE: "active",
  DISABLED: "disabled",
});

const OrganizationStatus = Object.freeze({
  ACTIVE: "active",
  DISABLED: "disabled",
});

const MembershipStatus = Object.freeze({
  ACTIVE: "active",
  REMOVED: "removed",
});

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "accessToken",
  "refreshToken",
  "token",
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
  RolePermissions,
  AssignableMemberRoles,
  AccountStatus,
  OrganizationStatus,
  MembershipStatus,
  ApiError,
  asyncHandler,
  slugify,
  redactSensitiveFields,
};
