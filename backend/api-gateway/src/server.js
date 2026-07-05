require("dotenv").config();
const express = require("express");
const redis = require("ioredis");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const logger = require("./utils/logger");
const redisClient = new redis(process.env.REDIS_URL);
const proxy = require("express-http-proxy");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// rate limit
const ratelimitOptions = rateLimit({
  windowMs: 15 * 60 * 1000, // 15Mins
  max: 100, // many no of request
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Sensitive endpoint rate limit exceed for this IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: "To many requests",
    });
  },
  store: new RedisStore({
    // new way
    sendCommand: (...args) => redisClient.call(args[0], ...args.slice(1)),
  }),
});

app.use(ratelimitOptions);
app.use((req, res, next) => {
  logger.info(`Received ${req.method} request to ${req.url}`);
  logger.info(`Request body: ${JSON.stringify(req.body)}`);
  next();
});

const proxyOptions = {
  proxyReqPathResolver: (req) => {
    return req.originalUrl.replace(/^\/v1/, "/api");
  },
  proxyErrorHandler: (err, res, next) => {
    logger.error(`Proxy error: ${err.message}`);
    res.status(500).json({
      message: `Internal server error`,
      error: err.message,
    });
  },
};
app.use(
  "/v1/auth",
  proxy(process.env.AUTH_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Auth service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);
app.use(
  "/v1/projects",
  proxy(process.env.PROJECT_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Project service: ${proxyRes.statusCode}`,
      );

      return proxyResData;
    },
    onError: (err, req, res) => {
      console.error("Proxy routing failed:", err.message);
      res.status(502).json({ error: "Bad Gateway: Service unreachable." });
    },
  }),
);
app.listen(PORT, () => {
  logger.info(`API Gateway is running on port ${PORT}`);
  logger.info(
    `Auth service is running on port ${process.env.AUTH_SERVICE_URL}`,
  );
  logger.info(
    `Project service is running on port ${process.env.PROJECT_SERVICE_URL}`,
  );

  logger.info(`Redis Url ${process.env.REDIS_URL}`);
});
