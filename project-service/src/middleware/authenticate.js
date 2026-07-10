const { ApiError } = require("../utils/constants");
const logger = require("../utils/logger");
const { verifyAccessToken } = require("../utils/tokens");

const authenticate = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return next(new ApiError(401, "Authentication token is required"));
  }

  try {
    const user = verifyAccessToken(header.slice(7));

    if (!user.sub || !user.organizationId || !user.membershipId || !user.role) {
      return next(new ApiError(401, "Invalid authentication token claims"));
    }

    req.user = user;
    return next();
  } catch (error) {
    logger.warn(`Access token verification failed: ${error.message}`);
    return next(new ApiError(401, "Invalid or expired authentication token"));
  }
};

module.exports = authenticate;
