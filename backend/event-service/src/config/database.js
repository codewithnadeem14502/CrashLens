const mongoose = require("mongoose");
const logger = require("../utils/logger");

const buildMongoUri = (uri) => {
  const separator = uri.includes("?") ? "&" : "?";

  if (uri.includes("retryWrites=")) {
    return uri;
  }

  return `${uri}${separator}retryWrites=false`;
};

const connectDatabase = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(buildMongoUri(mongoUri));
  logger.info("Connected to mongodb");
};

module.exports = connectDatabase;
