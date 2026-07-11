const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { buildCorsOptions } = require("./utils/cors");
const createIssueRouter = require("./routes/issue-route");
const createLogRouter = require("./routes/log-route");
const { redactSensitiveFields } = require("./utils/constants");

const app = express();

app.set("trust proxy", 1);

//middleware
app.use(helmet());
app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: "256kb" }));

app.use((req, res, next) => {
  logger.info(`Received ${req.method} request to ${req.url}`);
  logger.info(
    `Request body: ${JSON.stringify(redactSensitiveFields(req.body))}`,
  );
  next();
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "issue-service",
    status: "ok",
  });
});

// routes
// (previously also mounted a second, unprefixed time at "/" - that was
// dead/duplicate surface nothing in production reached, since api-gateway
// only ever proxies /v1/issues -> /api/issues. Removed as part of Module 1
// review: it needlessly exposed the full authenticated API unprefixed too.)
app.use("/api/issues", createIssueRouter());
app.use("/api/logs", createLogRouter());

app.use(errorHandler);

module.exports = app;
