const jwt = require("jsonwebtoken");

const ACCESS_TOKEN_ISSUER =
  process.env.ACCESS_TOKEN_ISSUER || "crash-lens-auth-service";

const getJwtSecret = () =>
  process.env.JWT_SECRET || "dev-auth-service-secret-change-me";

const verifyAccessToken = (token) =>
  jwt.verify(token, getJwtSecret(), {
    issuer: ACCESS_TOKEN_ISSUER,
  });

module.exports = {
  verifyAccessToken,
};
