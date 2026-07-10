require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const connectDatabase = require("./config/database");
const { startEventIngestedConsumer } = require("./consumers/event-ingested-consumer");
const errorHandler = require("./middleware/errorHandler");
const workerRoutes = require("./routes/worker-route");
const { redactSensitiveFields } = require("./utils/constants");
const logger = require("./utils/logger");
const { buildCorsOptions } = require("./utils/cors");
const { closeRabbitMQ, connectToRabbitMQ } = require("./utils/rabbitmq");

const app = express();
const PORT = process.env.PORT || 3004;

app.set("trust proxy", 1);

app.use(helmet());
app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: "256kb" }));

app.use((req, res, next) => {
  logger.info(`Received ${req.method} request to ${req.url}`);
  logger.debug(
    `Request body: ${JSON.stringify(redactSensitiveFields(req.body))}`,
  );
  next();
});

app.use("/", workerRoutes);
app.use(errorHandler);

async function startServer() {
  try {
    await connectDatabase();
    await connectToRabbitMQ();
    await startEventIngestedConsumer();

    app.listen(PORT, () => {
      logger.info(`worker-service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start worker-service: ${error.message}`);
    process.exit(1);
  }
}

const shutdown = async (signal) => {
  logger.info(`Received ${signal}; shutting down worker-service`);
  await closeRabbitMQ();
  process.exit(0);
};

startServer();

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled rejection: ${reason?.message || reason}`);
});

process.on("uncaughtException", (error) => {
  logger.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
