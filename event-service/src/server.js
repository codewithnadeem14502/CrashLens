require("dotenv").config();
const logger = require("./utils/logger");
const connectDatabase = require("./config/database");
const { closeRabbitMQ, connectToRabbitMQ } = require("./utils/rabbitmq");
const { startProjectEventConsumer } = require("./events/project-event-consumer");

const app = require("./app");
const PORT = process.env.PORT || 3003;

async function startServer() {
  try {
    await connectDatabase();
    await connectToRabbitMQ();
    await startProjectEventConsumer();
    app.listen(PORT, () => {
      logger.info(`event service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("Failed to connect to server", error);
    process.exit(1);
  }
}

startServer();

//unhandled promise rejection
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at", promise, "reason:", reason);
});

process.on("SIGTERM", async () => {
  await closeRabbitMQ();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await closeRabbitMQ();
  process.exit(0);
});
