require("dotenv").config();
const express = require("express");
const Redis = require("ioredis");
const cors = require("cors");
const helmet = require("helmet");
const errorHandler = require("./middleware/errorHandler");
const { startOccurrenceConsumer } = require("./events/issue-events");
const logger = require("./utils/logger");
const { buildCorsOptions } = require("./utils/cors");
const createIssueRouter = require("./routes/issue-route");
const connectDatabase = require("./config/database");
const { redactSensitiveFields } = require("./utils/constants");
const { RateLimiterRedis } = require("rate-limiter-flexible");
const { rateLimit } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { closeRabbitMQ, connectToRabbitMQ } = require("./utils/rabbitmq");

const app = express();
const PORT = process.env.PORT || 3005;

app.set("trust proxy", 1);

const redisClient = new Redis(process.env.REDIS_URL);

redisClient.on("error", (error) => {
  logger.error(`Redis connection error: ${error.message}`);
});

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

// Basic IP-based burst protection. This is not a full DDoS solution, but it
// protects the service from accidental or low-effort request floods.
const burstLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "issue-service:burst",
  points: 10,
  duration: 1,
});

app.use((req, res, next) => {
  burstLimiter
    .consume(req.ip)
    .then(() => next())
    .catch((rateLimiterError) => {
      if (!rateLimiterError || !rateLimiterError.msBeforeNext) {
        logger.error(`Burst limiter store error: ${rateLimiterError.message}`);
        return next();
      }

      logger.warn(`Rate limit exceed for this IP: ${req.ip}`);
      return res.status(429).json({
        success: false,
        message: "Too many requests",
      });
    });
});

// Rate limiter for sensitive endpoints
const sensitiveEndpointsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15Mins
  max: 50, // many no of request
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Sensitive endpoint rate limit exceed for this IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: "Too many requests",
    });
  },
  passOnStoreError: true,
  store: new RedisStore({
    prefix: "issue-service:sensitive:",
    sendCommand: (...args) => redisClient.call(args[0], ...args.slice(1)),
  }),
});
// sensitiveEndpointsLimiter

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "issue-service",
    status: "ok",
  });
});

// routes
app.use(
  "/api/issues",
  createIssueRouter({ sensitiveLimiter: sensitiveEndpointsLimiter }),
);
app.use("/", createIssueRouter({ sensitiveLimiter: sensitiveEndpointsLimiter }));

app.use(errorHandler);

async function startServer() {
  try {
    await connectDatabase();
    await connectToRabbitMQ();
    await startOccurrenceConsumer();
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
