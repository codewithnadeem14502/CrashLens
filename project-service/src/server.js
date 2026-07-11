require("dotenv").config();
const logger = require("./utils/logger");
const { assertJwtSecret } = require("./utils/assertJwtSecret");
const app = require("./app");
const connectDatabase = require("./config/database");
const { closeRabbitMQ, connectToRabbitMQ } = require("./utils/rabbitmq");
const { closeRedis, redisClient } = require("./utils/redis");

const PORT = process.env.PORT || 3002;

async function startServer() {
  try {
    // Fail closed: refuse to boot if JWT_SECRET is missing or the known
    // default placeholder, before touching Mongo/RabbitMQ or listening.
    assertJwtSecret();

    connectDatabase().catch((e) => logger.error("Mongo connection error", e));

    // redisClient is constructed with lazyConnect (see utils/redis.js) so
    // requiring it doesn't open a connection at module-load time (needed
    // for app.js to stay side-effect-free in tests). That means something
    // has to explicitly trigger the connection at real startup - the
    // controller's canUseRedis() check only reads redisClient.status
    // without ever issuing a command, so it can never self-trigger the
    // lazy connect on its own; without this call the cache-aside layer
    // would silently never leave "wait" status and every cache read/write
    // would permanently no-op.
    redisClient
      .connect()
      .catch((e) => logger.error("Redis connection error", e));

    await connectToRabbitMQ();
    app.listen(PORT, () => {
      logger.info(`project service running on port ${PORT}`);
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
  await closeRedis();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await closeRabbitMQ();
  await closeRedis();
  process.exit(0);
});
