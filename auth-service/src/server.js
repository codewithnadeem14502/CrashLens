require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { buildCorsOptions } = require("./utils/cors");
const authRoutes = require("./routes/auth-route");
const connectDatabase = require("./config/database");
const { redactSensitiveFields } = require("./utils/constants");

const app = express();
const PORT = process.env.PORT || 3001;

app.set("trust proxy", 1);

connectDatabase().catch((e) => logger.error("Mongo connection error", e));

//middleware
app.use(helmet());
app.use(cors(buildCorsOptions()));
app.use(express.json());

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
    service: "auth-service",
    status: "ok",
  });
});

app.use("/api/auth", authRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`auth service running on port ${PORT}`);
});

//unhandled promise rejection
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at", promise, "reason:", reason);
});
