const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  logger.error(err.stack || err.message);

  const statusCode = err.statusCode || err.status || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal server error",
    details: err.details,
  });
};

module.exports = errorHandler;
