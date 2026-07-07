const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;

  if (statusCode >= 500) {
    logger.error(err.stack || err.message);
  } else if (err.details) {
    const details = Array.isArray(err.details)
      ? err.details.join("; ")
      : JSON.stringify(err.details);

    logger.warn(`${statusCode} ${err.message}: ${details}`);
  } else {
    logger.warn(`${statusCode} ${err.message}`);
  }

  const response = {
    success: false,
    message: err.message || "Internal server error",
  };

  if (statusCode < 500 && err.details) {
    response.details = err.details;
  }

  return res.status(statusCode).json(response);
};

module.exports = errorHandler;
