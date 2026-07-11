const jwt = require("jsonwebtoken");

const ACCESS_TOKEN_ISSUER =
  process.env.ACCESS_TOKEN_ISSUER || "crash-lens-auth-service";

// No hardcoded fallback: assertJwtSecret() (called at process boot in
// server.js) already refuses to start the service if JWT_SECRET is unset
// or still the known default, so by the time this runs JWT_SECRET is safe
// to read directly.
const getJwtSecret = () => process.env.JWT_SECRET;

const verifyAccessToken = (token) =>
  jwt.verify(token, getJwtSecret(), {
    issuer: ACCESS_TOKEN_ISSUER,
  });

module.exports = {
  verifyAccessToken,
};
