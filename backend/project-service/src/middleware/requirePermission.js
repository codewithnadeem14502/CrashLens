const { ApiError } = require("../utils/constants");

const requirePermission = (permission) => (req, res, next) => {
  const permissions = req.user && req.user.permissions;

  if (!Array.isArray(permissions)) {
    return next(new ApiError(403, "Permission denied"));
  }

  if (permissions.includes("*") || permissions.includes(permission)) {
    return next();
  }

  return next(new ApiError(403, "Permission denied"));
};

module.exports = requirePermission;
