require("dotenv").config();
const logger = require("./utils/logger");
const { assertJwtSecret } = require("./utils/assertJwtSecret");
const app = require("./app");
const { startOccurrenceConsumer } = require("./events/issue-events");
const { startTransactionConsumer } = require("./events/performance-events");
const { startLogsConsumer } = require("./events/log-events");
const connectDatabase = require("./config/database");
const { closeRabbitMQ, connectToRabbitMQ } = require("./utils/rabbitmq");

const PORT = process.env.PORT || 3005;

async function startServer() {
  try {
    // Fail closed: refuse to boot if JWT_SECRET is missing or the known
    // default placeholder, before touching Mongo/RabbitMQ or listening.
    assertJwtSecret();

    await connectDatabase();
    await connectToRabbitMQ();
    await startOccurrenceConsumer();
    await startTransactionConsumer();
    await startLogsConsumer();
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
