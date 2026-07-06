const crypto = require("crypto");
const DsnCache = require("../models/dsn-cache-model");
const { publishEventIngested } = require("../events/event-publisher");
const { ApiError, ProjectStatus, asyncHandler } = require("../utils/constants");
const { parseDsn } = require("../utils/dsn");
const logger = require("../utils/logger");
const { validateEventPayload } = require("../utils/validation");

const ingestEvent = asyncHandler(async (req, res) => {
  const payload = validateEventPayload(req.body);
  const parsedDsn = parseDsn(payload.dsn);

  logger.info(
    `Received ${payload.event.type} event for project ${parsedDsn.projectId}`,
  );

  const dsnCache = await DsnCache.findOne({
    projectId: parsedDsn.projectId,
    dsnPublicKey: parsedDsn.dsnPublicKey,
  });

  if (!dsnCache) {
    logger.warn(`Rejected event for project ${parsedDsn.projectId}: invalid DSN`);
    throw new ApiError(401, "Invalid DSN");
  }

  if (dsnCache.status !== ProjectStatus.ACTIVE) {
    logger.warn(
      `Rejected event for project ${parsedDsn.projectId}: project status is ${dsnCache.status}`,
    );
    throw new ApiError(403, "Project is not active");
  }

  const eventId = `evt_${crypto.randomUUID()}`;

  logger.info(
    `Publishing ingested event ${eventId} for project ${parsedDsn.projectId}`,
  );

  await publishEventIngested({
    eventId,
    dsnCache,
    parsedDsn,
    event: payload.event,
  });

  logger.info(`Accepted event ${eventId} for project ${parsedDsn.projectId}`);

  return res.status(202).json({
    success: true,
    message: "Event accepted",
    eventId,
  });
});

module.exports = {
  ingestEvent,
};
