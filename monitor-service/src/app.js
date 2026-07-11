const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { buildCorsOptions } = require("./utils/cors");
const monitorRoutes = require("./routes/monitor-route");
const uptimeRoutes = require("./routes/uptime-route");
const { redactSensitiveFields } = require("./utils/constants");

const app = express();

app.set("trust proxy", 1);

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
    service: "monitor-service",
    status: "ok",
  });
});

app.use("/api/monitors", monitorRoutes);
app.use("/api/uptime-monitors", uptimeRoutes);

app.use(errorHandler);

module.exports = app;
