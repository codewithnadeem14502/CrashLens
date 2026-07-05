const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const getJwtSecret = () =>
  process.env.JWT_SECRET || "dev-auth-service-secret-change-me";

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const generateRefreshToken = () => crypto.randomBytes(64).toString("hex");

const getRefreshTokenExpiryDate = () => {
  const days = Number(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || 7);
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
      expiresIn: process.env.JWT_EXPIRES_IN || "1h",
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
