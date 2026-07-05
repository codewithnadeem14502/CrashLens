const winston = require("winston");
const { Level, NodeEnv } = require("./constants");

const logger = winston.createLogger({
  level:
    process.env.NODE_ENV === NodeEnv.DEVELOPMENT ? Level.INFO : Level.DEBUG,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }), // stack trace of error
    winston.format.splat(), // support for message template
    winston.format.json(),
  ),
  defaultMeta: { service: "api-gateway" },
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
