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

// alert-service is the first service that also needs to mint its own short-
// lived tokens (not just verify user-issued ones) - the evaluation engine
// calls issue-service's/monitor-service's existing authenticated query APIs
// on a background timer, with no end-user request in flight to forward a
// bearer token from. Any service holding JWT_SECRET can already mint a
// token those services will accept (see real-architecture-reference.md's
// "Auth and RBAC" section - there's no separate service-to-service
// verification path), so this isn't a new trust boundary, just the first
// service to use that capability. Scoped to a fixed system principal with
// only the read permissions the query executor needs - never ADMIN, never
// a real user's identity.
const SYSTEM_PRINCIPAL = Object.freeze({
  sub: "system:alert-service",
  organizationSubjectClaim: "organizationId",
});

const mintSystemToken = (organizationId, permissions) =>
  jwt.sign(
    {
      sub: SYSTEM_PRINCIPAL.sub,
      organizationId,
      membershipId: "system:alert-service",
      role: "system",
      permissions,
    },
    getJwtSecret(),
    {
      issuer: ACCESS_TOKEN_ISSUER,
      expiresIn: "60s",
    },
  );

module.exports = {
  verifyAccessToken,
  mintSystemToken,
};
