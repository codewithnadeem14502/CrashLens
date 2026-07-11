const winston = require("winston");
const { Level, NodeEnv } = require("./constants");

const getLogLevel = () => {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }

  return process.env.NODE_ENV === NodeEnv.DEVELOPMENT
    ? Level.DEBUG
    : Level.INFO;
};

const logger = winston.createLogger({
  level: getLogLevel(),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }), // stack trace of error
    winston.format.splat(), // support for message template
    winston.format.json(),
  ),
  defaultMeta: { service: "monitor-service" },
  transports: [
    // output dentation (Console & File)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.simple(),
        winston.format.colorize(),
      ),
    }),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combine.log" }),
  ],
});

module.exports = logger;
