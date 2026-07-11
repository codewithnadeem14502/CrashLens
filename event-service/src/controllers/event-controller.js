const crypto = require("crypto");
const DsnCache = require("../models/dsn-cache-model");
const {
  publishEventIngested,
  publishTransactionIngested,
  publishLogsIngested,
} = require("../events/event-publisher");
const { ApiError, ProjectStatus, asyncHandler } = require("../utils/constants");
const { parseDsn } = require("../utils/dsn");
const logger = require("../utils/logger");
const {
  validateEventPayload,
  validateTransactionPayload,
  validateLogsPayload,
} = require("../utils/validation");

const getActiveDsnCache = async (parsedDsn) => {
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
      `Rejected ingest for project ${parsedDsn.projectId}: project status is ${dsnCache.status}`,
    );
    throw new ApiError(403, "Project is not active");
  }

  return dsnCache;
};

const ingestEvent = asyncHandler(async (req, res) => {
  const payload = validateEventPayload(req.body);
  const parsedDsn = parseDsn(payload.dsn);

  logger.info(
    `Received ${payload.event.type} event for project ${parsedDsn.projectId}`,
  );

  const dsnCache = await getActiveDsnCache(parsedDsn);
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

const ingestTransaction = asyncHandler(async (req, res) => {
  const payload = validateTransactionPayload(req.body);
  const parsedDsn = parseDsn(payload.dsn);

  logger.info(
    `Received transaction ${payload.transaction.method} ${payload.transaction.route} for project ${parsedDsn.projectId}`,
  );

  const dsnCache = await getActiveDsnCache(parsedDsn);
  const transactionId = `txn_${crypto.randomUUID()}`;

  logger.info(
    `Publishing ingested transaction ${transactionId} for project ${parsedDsn.projectId}`,
  );

  await publishTransactionIngested({
    transactionId,
    dsnCache,
    parsedDsn,
    transaction: payload.transaction,
  });

  logger.info(
    `Accepted transaction ${transactionId} for project ${parsedDsn.projectId}`,
  );

  return res.status(202).json({
    success: true,
    message: "Transaction accepted",
    transactionId,
  });
});

const ingestLogs = asyncHandler(async (req, res) => {
  const payload = validateLogsPayload(req.body);
  const parsedDsn = parseDsn(payload.dsn);

  logger.info(
    `Received a batch of ${payload.logs.length} log(s) for project ${parsedDsn.projectId}`,
  );

  const dsnCache = await getActiveDsnCache(parsedDsn);
  const batchId = `logs_${crypto.randomUUID()}`;

  logger.info(
    `Publishing ingested log batch ${batchId} for project ${parsedDsn.projectId}`,
  );

  await publishLogsIngested({
    batchId,
    dsnCache,
    parsedDsn,
    logs: payload.logs,
  });

  logger.info(`Accepted log batch ${batchId} for project ${parsedDsn.projectId}`);

  return res.status(202).json({
    success: true,
    message: "Logs accepted",
    batchId,
  });
});

module.exports = {
  ingestEvent,
  ingestTransaction,
  ingestLogs,
};
