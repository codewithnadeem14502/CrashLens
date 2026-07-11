require("dotenv").config();
const logger = require("./utils/logger");
const { assertJwtSecret } = require("./utils/assertJwtSecret");
const app = require("./app");
const connectDatabase = require("./config/database");
const { startAlertEvaluator, stopAlertEvaluator } = require("./jobs/alert-evaluator");

const PORT = process.env.PORT || 3007;

async function startServer() {
  try {
    // Fail closed: refuse to boot if JWT_SECRET is missing or the known
    // default placeholder - same guard as every other JWT_SECRET-touching
    // service. alert-service both verifies user tokens (protecting its own
    // routes) and mints its own short-lived system tokens (to call
    // issue-service/monitor-service), so this matters even more here than
    // in a service that only verifies.
    assertJwtSecret();

    await connectDatabase();

    startAlertEvaluator();

    app.listen(PORT, () => {
      logger.info(`alert-service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start alert-service: ${error.message}`);
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
  logger.info(`Received ${signal}; shutting down alert-service`);
  stopAlertEvaluator();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
