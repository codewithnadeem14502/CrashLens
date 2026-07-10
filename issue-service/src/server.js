require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const errorHandler = require("./middleware/errorHandler");
const { startOccurrenceConsumer } = require("./events/issue-events");
const { startTransactionConsumer } = require("./events/performance-events");
const logger = require("./utils/logger");
const { buildCorsOptions } = require("./utils/cors");
const createIssueRouter = require("./routes/issue-route");
const connectDatabase = require("./config/database");
const { redactSensitiveFields } = require("./utils/constants");
const { closeRabbitMQ, connectToRabbitMQ } = require("./utils/rabbitmq");

const app = express();
const PORT = process.env.PORT || 3005;

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
app.use("/api/issues", createIssueRouter());
app.use("/", createIssueRouter());

app.use(errorHandler);

async function startServer() {
  try {
    await connectDatabase();
    await connectToRabbitMQ();
    await startOccurrenceConsumer();
    await startTransactionConsumer();
    app.listen(PORT, () => {
      logger.info(`issue-service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start issue-service: ${error.message}`);
    process.exit(1);
  }
}

startServer();

//unhandled promise rejection
process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled rejection: ${reason?.message || reason}`);
});

process.on("uncaughtException", (error) => {
  logger.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

const shutdown = async (signal) => {
  logger.info(`Received ${signal}; shutting down issue-service`);
  await closeRabbitMQ();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
