const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");

const ACCESS_TOKEN_ISSUER =
  process.env.ACCESS_TOKEN_ISSUER || "crash-lens-auth-service";

// Routes a caller must be able to reach *without* a token, because they are
// how a token is obtained (or given up) in the first place. Kept as an
// explicit allowlist (method + exact path) rather than a broad prefix match
// on "/v1/auth" so every other auth-service route (org/member management,
// password change) still requires a token at the gateway.
const PUBLIC_AUTH_ROUTES = [
  { method: "POST", path: "/v1/auth/login" },
  { method: "POST", path: "/v1/auth/organizations" },
  { method: "POST", path: "/v1/auth/refresh-token" },
  { method: "POST", path: "/v1/auth/logout" },
  { method: "PATCH", path: "/v1/auth/update-password" },
];

// Exact segment match, not a bare prefix: "/v1/events" or "/v1/events/*"
// only - a future route like "/v1/events-report" must not silently bypass
// JWT verification just because it happens to start with the same string.
const isIngestionRoute = (req) =>
  req.path === "/v1/events" || req.path.startsWith("/v1/events/");

// Module 8: a monitor's check-in ping is hit by an external cron job
// holding only that monitor's checkToken (see monitor-service's
// monitor-controller.js), the same "credential instead of a user JWT"
// design as DSN-authenticated event ingestion - so these two specific
// routes must be exempt too. Deliberately method-specific: the sibling
// `GET /v1/monitors/:monitorId/checkins` (check-in *history*, viewed from
// the dashboard) is NOT exempt and still requires a JWT - only the
// external-facing POST (start/single-ping) and PATCH (finish) do.
const MONITOR_CHECKIN_PATTERN = /^\/v1\/monitors\/[^/]+\/checkins(\/[^/]+)?$/;
const isMonitorCheckInPing = (req) =>
  (req.method === "POST" || req.method === "PATCH") &&
  MONITOR_CHECKIN_PATTERN.test(req.path);

const isPublicAuthRoute = (req) =>
  PUBLIC_AUTH_ROUTES.some(
    (route) => route.method === req.method && req.path === route.path,
  );

/**
 * Gateway-level JWT verification, additive on top of each downstream
 * service's own `authenticate` middleware (project-service, issue-service
 * both verify independently) - this is defense-in-depth / fail-fast-at-
 * the-edge, not a replacement for service-level checks.
 *
 * Ingestion (/v1/events*) is intentionally exempt: it is authenticated by
 * the DSN in the payload, not a user JWT - do NOT add JWT verification
 * there, that is a deliberate, confirmed-correct design decision.
 */
const authenticate = (req, res, next) => {
  if (
    isIngestionRoute(req) ||
    isPublicAuthRoute(req) ||
    isMonitorCheckInPing(req)
  ) {
    return next();
  }

  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Authentication token is required" });
  }

  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, {
      issuer: ACCESS_TOKEN_ISSUER,
    });

    if (
      !payload.sub ||
      !payload.organizationId ||
      !payload.membershipId ||
      !payload.role
    ) {
      return res
        .status(401)
        .json({ message: "Invalid authentication token claims" });
    }

    req.user = payload;
    return next();
  } catch (error) {
    logger.warn(`Gateway JWT verification failed: ${error.message}`);
    return res
      .status(401)
      .json({ message: "Invalid or expired authentication token" });
  }
};

module.exports = authenticate;
