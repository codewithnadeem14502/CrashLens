const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const Redis = require("ioredis");
const logger = require("../utils/logger");

const redisClient = new Redis(
  process.env.REDIS_URL || "redis://127.0.0.1:6379",
  {
    // Don't crash the gateway process on a transient Redis blip; let
    // ioredis retry in the background and just log failures.
    maxRetriesPerRequest: 1,
    // Defer the actual TCP connection until the first Redis command is
    // issued (i.e. the first rate-limited request), rather than at module
    // require time. Lets this module (and app.js) be required safely - in
    // tests, or if Redis is briefly unavailable at boot - without opening a
    // background reconnect loop before the app has even started.
    lazyConnect: true,
  },
);

redisClient.on("error", (error) => {
  logger.error(`Gateway rate-limiter Redis error: ${error.message}`);
});

const WINDOW_MS = Number.parseInt(
  process.env.RATE_LIMIT_WINDOW_MS || `${60 * 1000}`,
  10,
);
const MAX_REQUESTS_PER_WINDOW = Number.parseInt(
  process.env.RATE_LIMIT_MAX_REQUESTS || "300",
  10,
);

// Global per-IP limiter, applied to every proxied route (including
// ingestion - DSN auth doesn't exempt a client from rate limiting, it's
// still an unauthenticated-by-user-identity path and is the most
// abuse-prone one). Redis-backed so limits are shared across gateway
// instances instead of being per-process.
const rateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_REQUESTS_PER_WINDOW,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    // Configurable so multiple gateway deployments can share one Redis
    // instance without colliding, and so tests can use an isolated
    // namespace instead of polluting/reading real rate-limit counters.
    prefix: process.env.RATE_LIMIT_KEY_PREFIX || "rl:gateway:",
    sendCommand: (...args) => redisClient.call(...args),
  }),
  handler: (req, res) => {
    res
      .status(429)
      .json({ message: "Too many requests, please try again later." });
  },
});

// Exported as a property on the middleware function itself (rather than
// wrapping the export in an object) so `app.use(rateLimiter)` keeps working
// unchanged, while tests can still reach the underlying client to clean up
// keys / close the connection after a run.
rateLimiter.redisClient = redisClient;

module.exports = rateLimiter;
