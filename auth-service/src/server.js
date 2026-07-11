require("dotenv").config();
const logger = require("./utils/logger");
const { assertJwtSecret } = require("./utils/assertJwtSecret");

// Fail closed: refuse to boot if JWT_SECRET is missing or the known
// default placeholder. Must run before anything else starts (DB connect,
// app setup) so a misconfigured deploy never serves traffic.
try {
  assertJwtSecret();
} catch (error) {
  logger.error(`FATAL: ${error.message}`);
  process.exit(1);
}

const app = require("./app");
const connectDatabase = require("./config/database");

const PORT = process.env.PORT || 3001;

connectDatabase().catch((e) => logger.error("Mongo connection error", e));

app.listen(PORT, () => {
  logger.info(`auth service running on port ${PORT}`);
});

//unhandled promise rejection
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at", promise, "reason:", reason);
});
