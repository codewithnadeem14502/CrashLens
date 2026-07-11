require("dotenv").config();
const logger = require("./utils/logger");
const { assertJwtSecret } = require("./utils/assertJwtSecret");

// Fail closed: the gateway now verifies JWTs itself (see
// middleware/authenticate.js), so it must refuse to boot under the same
// conditions the services that issue/verify tokens do.
try {
  assertJwtSecret();
} catch (error) {
  logger.error(`FATAL: ${error.message}`);
  process.exit(1);
}

const app = require("./app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`API Gateway is running on port ${PORT}`);
  logger.info(
    `Auth service is running on port ${process.env.AUTH_SERVICE_URL}`,
  );
  logger.info(
    `Project service is running on port ${process.env.PROJECT_SERVICE_URL}`,
  );
  logger.info(
    `Event service is running on port ${process.env.EVENT_SERVICE_URL}`,
  );
  logger.info(
    `Issue service is running on port ${process.env.ISSUE_SERVICE_URL}`,
  );
});
