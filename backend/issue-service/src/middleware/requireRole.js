const { ApiError } = require("../utils/constants");

const requireRole = (...allowedRoles) => (req, res, next) => {
  if (allowedRoles.includes(req.user && req.user.role)) {
    return next();
  }

  return next(new ApiError(403, "Permission denied"));
};

module.exports = requireRole;
