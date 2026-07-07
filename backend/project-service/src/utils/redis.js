const Redis = require("ioredis");
const logger = require("./logger");

const redisClient = new Redis(process.env.REDIS_URL);

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
