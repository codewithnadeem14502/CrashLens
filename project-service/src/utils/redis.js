const Redis = require("ioredis");
const logger = require("./logger");

// lazyConnect: defer the actual TCP connection until the first Redis
// command is issued, rather than at module require time. Without this,
// requiring this module (e.g. transitively via src/app.js in tests) opens
// a live connection that keeps the process alive - node --test then never
// exits on its own, since nothing ever calls closeRedis() in a test run
// that doesn't go through server.js's SIGTERM/SIGINT handlers.
const redisClient = new Redis(process.env.REDIS_URL, { lazyConnect: true });

redisClient.on("error", (error) => {
  logger.error(`Redis connection error: ${error.message}`);
});

const closeRedis = async () => {
  await redisClient.quit();
};

module.exports = {
  closeRedis,
  redisClient,
};
