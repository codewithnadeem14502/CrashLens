const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// No hardcoded fallback: assertJwtSecret() (called at process boot in
// server.js) already refuses to start the service if JWT_SECRET is unset
// or still the known default, so by the time this runs JWT_SECRET is safe
// to read directly.
const getJwtSecret = () => process.env.JWT_SECRET;

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const generateRefreshToken = () => crypto.randomBytes(64).toString("hex");

const getRefreshTokenExpiryDate = () => {
  const days = Number(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || 15);
  const expiresAt = new Date();

  expiresAt.setDate(expiresAt.getDate() + days);

  return expiresAt;
};

const signAccessToken = ({ user, membership, permissions }) =>
  jwt.sign(
    {
      sub: user._id.toString(),
      organizationId: membership.organizationId.toString(),
      membershipId: membership._id.toString(),
      role: membership.role,
      permissions,
    },
    getJwtSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "2m",
      issuer: "crash-lens-auth-service",
    },
  );

const verifyAccessToken = (token) =>
  jwt.verify(token, getJwtSecret(), {
    issuer: "crash-lens-auth-service",
  });

module.exports = {
  generateRefreshToken,
  getRefreshTokenExpiryDate,
  hashToken,
  signAccessToken,
  verifyAccessToken,
};
