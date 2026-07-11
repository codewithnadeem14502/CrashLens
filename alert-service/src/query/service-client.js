const { mintSystemToken } = require("../utils/tokens");
const { ApiError } = require("../utils/constants");
const logger = require("../utils/logger");

// alert-service is the first synchronous inter-service HTTP caller in this
// codebase (every other cross-service read either goes through RabbitMQ or
// doesn't exist yet) - it calls issue-service/monitor-service directly by
// their internal URLs, the same env vars api-gateway itself uses to reach
// them, rather than looping back through the gateway for purely internal
// traffic. See utils/tokens.js's mintSystemToken for the auth story: a
// short-lived, narrowly-scoped (view-only) token signed with the same
// JWT_SECRET every service already trusts.
const ISSUE_SERVICE_URL = process.env.ISSUE_SERVICE_URL || "http://localhost:3005";
const MONITOR_SERVICE_URL = process.env.MONITOR_SERVICE_URL || "http://localhost:3006";
const SERVICE_CALL_TIMEOUT_MS = Number.parseInt(
  process.env.SERVICE_CALL_TIMEOUT_MS || "8000",
  10,
);

const ISSUE_SERVICE_PERMISSIONS = ["issue:view"];
const MONITOR_SERVICE_PERMISSIONS = ["monitor:view"];

async function callService(baseUrl, path, params, permissions, organizationId) {
  const token = mintSystemToken(organizationId, permissions);
  const url = new URL(`${baseUrl}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVICE_CALL_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      logger.warn(`Upstream query to ${url.pathname} failed: ${response.status}`);

      // A 4xx here means the query itself was rejected by the upstream
      // service (e.g. a filter value that's a valid bounded string at this
      // service's own Joi layer but not a real enum value once it reaches
      // issue-service/monitor-service's stricter validation) - that's the
      // caller's problem, not an upstream outage, so surface the real
      // status and message instead of flattening every failure to a 502.
      const statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
      throw new ApiError(statusCode, body?.message || `Upstream query failed (${response.status})`, body?.details);
    }

    return body.data ?? body;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    logger.warn(`Upstream query to ${url.pathname} errored: ${error.message}`);
    throw new ApiError(502, "Upstream service unreachable");
  } finally {
    clearTimeout(timeout);
  }
}

const listIssues = (organizationId, params) =>
  callService(ISSUE_SERVICE_URL, "/api/issues", params, ISSUE_SERVICE_PERMISSIONS, organizationId);

const listLogs = (organizationId, params) =>
  callService(ISSUE_SERVICE_URL, "/api/logs", params, ISSUE_SERVICE_PERMISSIONS, organizationId);

const listPerformanceEndpoints = (organizationId, params) =>
  callService(
    ISSUE_SERVICE_URL,
    "/api/issues/performance/endpoints",
    params,
    ISSUE_SERVICE_PERMISSIONS,
    organizationId,
  );

const getEndpointPerformance = (organizationId, endpointId, params) =>
  callService(
    ISSUE_SERVICE_URL,
    `/api/issues/performance/endpoints/${encodeURIComponent(endpointId)}`,
    params,
    ISSUE_SERVICE_PERMISSIONS,
    organizationId,
  );

const listMonitors = (organizationId, params) =>
  callService(MONITOR_SERVICE_URL, "/api/monitors", params, MONITOR_SERVICE_PERMISSIONS, organizationId);

const listUptimeMonitors = (organizationId, params) =>
  callService(
    MONITOR_SERVICE_URL,
    "/api/uptime-monitors",
    params,
    MONITOR_SERVICE_PERMISSIONS,
    organizationId,
  );

module.exports = {
  listIssues,
  listLogs,
  listPerformanceEndpoints,
  getEndpointPerformance,
  listMonitors,
  listUptimeMonitors,
};
