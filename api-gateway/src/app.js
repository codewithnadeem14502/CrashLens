const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const proxy = require("express-http-proxy");
const logger = require("./utils/logger");
const { buildCorsOptions } = require("./utils/cors");
const { redactSensitiveFields } = require("./utils/constants");
const authenticate = require("./middleware/authenticate");
const rateLimiter = require("./middleware/rateLimiter");
const errorHandler = require("./middleware/errorHandler");

const app = express();

app.set("trust proxy", 1);

// Middleware
app.use(cors(buildCorsOptions()));
app.use(helmet());
app.use(express.json());

app.use((req, res, next) => {
  logger.info(`Received ${req.method} request to ${req.url}`);
  // Security review finding (Module 8): this used to log req.body with no
  // redaction at all - the gateway sees every request FIRST, before any
  // downstream service's own redaction runs, so an unredacted log here
  // defeated the point of redacting anywhere else. Every route's secrets
  // (login passwords, monitor check-in tokens, etc.) are covered by
  // SENSITIVE_KEYS, same convention as every other service.
  logger.info(
    `Request body: ${JSON.stringify(redactSensitiveFields(req.body))}`,
  );
  next();
});

// Redis-backed rate limiting first (cheap, protects against floods before
// spending effort on JWT verification), then JWT verification (additive on
// top of each service's own auth check; exempts ingestion and the public
// auth routes - see middleware/authenticate.js).
app.use(rateLimiter);
app.use(authenticate);

const proxyOptions = {
  proxyReqPathResolver: (req) => {
    return req.originalUrl.replace(/^\/v1/, "/api");
  },
  proxyErrorHandler: (err, res, next) => {
    logger.error(`Proxy error: ${err.message}`);
    res.status(500).json({
      message: `Internal server error`,
      error: err.message,
    });
  },
};
app.use(
  "/v1/auth",
  proxy(process.env.AUTH_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Auth service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);
app.use(
  "/v1/projects",
  proxy(process.env.PROJECT_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Project service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);
app.use(
  "/v1/events",
  proxy(process.env.EVENT_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Event service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);
app.use(
  "/v1/issues",
  proxy(process.env.ISSUE_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Issue service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);
// Module 7: logs are queried out of issue-service (same as /v1/issues),
// just a different route mount within that service (/api/logs vs
// /api/issues) - same ISSUE_SERVICE_URL target, no new env var needed.
app.use(
  "/v1/logs",
  proxy(process.env.ISSUE_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Log service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);

// Module 8: monitor-service owns both cron (Monitor/CheckIn) and uptime
// (UptimeMonitor/UptimeCheck) resources, proxied here as two separate
// mounts (mirrors /v1/issues vs /v1/logs both hitting issue-service under
// different route prefixes).
app.use(
  "/v1/monitors",
  proxy(process.env.MONITOR_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Monitor service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);
app.use(
  "/v1/uptime-monitors",
  proxy(process.env.MONITOR_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Monitor service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);

// Module 9: alert-service owns dashboards/widgets, the generic query
// executor's preview endpoint, and alert rules/history - three separate
// mounts, same pattern as monitor-service's two above. No JWT exemption
// needed (unlike ingestion or monitor check-in pings): every alert-service
// route requires a real user JWT, since nothing here is machine-credentialed.
app.use(
  "/v1/dashboards",
  proxy(process.env.ALERT_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Alert service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);
app.use(
  "/v1/query",
  proxy(process.env.ALERT_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Alert service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);
app.use(
  "/v1/alerts",
  proxy(process.env.ALERT_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Alert service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);

app.use(errorHandler);

module.exports = app;
