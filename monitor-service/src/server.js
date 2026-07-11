require("dotenv").config();
const logger = require("./utils/logger");
const { assertJwtSecret } = require("./utils/assertJwtSecret");
const app = require("./app");
const connectDatabase = require("./config/database");
const { closeRabbitMQ, connectToRabbitMQ } = require("./utils/rabbitmq");
const { startCronSweep, stopCronSweep } = require("./jobs/cron-sweep");
const { startUptimeProber, stopUptimeProber } = require("./jobs/uptime-prober");

const PORT = process.env.PORT || 3006;

async function startServer() {
  try {
    // Fail closed: refuse to boot if JWT_SECRET is missing or the known
    // default placeholder, before touching Mongo/RabbitMQ or listening -
    // same guard as auth-service/project-service/issue-service/api-gateway.
    assertJwtSecret();

    await connectDatabase();
    await connectToRabbitMQ();

    startCronSweep();
    startUptimeProber();

    app.listen(PORT, () => {
      logger.info(`monitor-service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start monitor-service: ${error.message}`);
    process.exit(1);
  }
}

startServer();

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled rejection: ${reason?.message || reason}`);
});

process.on("uncaughtException", (error) => {
  logger.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

const shutdown = async (signal) => {
  logger.info(`Received ${signal}; shutting down monitor-service`);
  stopCronSweep();
  stopUptimeProber();
  await closeRabbitMQ();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
