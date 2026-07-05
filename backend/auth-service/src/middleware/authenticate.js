const { ApiError } = require("../utils/constants");
const { verifyAccessToken } = require("../utils/tokens");

const authenticate = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return next(new ApiError(401, "Authentication token is required"));
  }

  try {
    req.user = verifyAccessToken(header.slice(7));
    return next();
  } catch (error) {
    return next(new ApiError(401, "Invalid or expired authentication token"));
  }
};

module.exports = authenticate;
