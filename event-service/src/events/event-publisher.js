const crypto = require("crypto");
const { publishEvent } = require("../utils/rabbitmq");
const { EventTypes } = require("../utils/constants");
const logger = require("../utils/logger");

const publishEventIngested = async ({ eventId, dsnCache, parsedDsn, event }) => {
  const envelope = {
    eventId,
    eventType: EventTypes.EVENT_INGESTED,
    schemaVersion: 1,
    producer: "event-service",
    occurredAt: new Date().toISOString(),
    data: {
      ingestionId: crypto.randomUUID(),
      projectId: dsnCache.projectId.toString(),
      organizationId: dsnCache.organizationId.toString(),
      dsnPublicKey: parsedDsn.dsnPublicKey,
      environment: event.environment || dsnCache.environment,
      receivedAt: new Date().toISOString(),
      event,
    },
  };

  await publishEvent(EventTypes.EVENT_INGESTED, envelope);
  logger.info(
    `Published ${EventTypes.EVENT_INGESTED} ${eventId} for project ${envelope.data.projectId}`,
  );

  return envelope;
};

const publishTransactionIngested = async ({
  transactionId,
  dsnCache,
  parsedDsn,
  transaction,
}) => {
  const envelope = {
    eventId: transactionId,
    eventType: EventTypes.TRANSACTION_INGESTED,
    schemaVersion: 1,
    producer: "event-service",
    occurredAt: new Date().toISOString(),
    data: {
      transactionId,
      ingestionId: crypto.randomUUID(),
      projectId: dsnCache.projectId.toString(),
      organizationId: dsnCache.organizationId.toString(),
      dsnPublicKey: parsedDsn.dsnPublicKey,
      environment: transaction.environment || dsnCache.environment,
      receivedAt: new Date().toISOString(),
      transaction,
    },
  };

  await publishEvent(EventTypes.TRANSACTION_INGESTED, envelope);
  logger.info(
    `Published ${EventTypes.TRANSACTION_INGESTED} ${transactionId} for project ${envelope.data.projectId}`,
  );

  return envelope;
};

const publishLogsIngested = async ({ batchId, dsnCache, parsedDsn, logs }) => {
  const envelope = {
    eventId: batchId,
    eventType: EventTypes.LOGS_INGESTED,
    schemaVersion: 1,
    producer: "event-service",
    occurredAt: new Date().toISOString(),
    data: {
      batchId,
      ingestionId: crypto.randomUUID(),
      projectId: dsnCache.projectId.toString(),
      organizationId: dsnCache.organizationId.toString(),
      dsnPublicKey: parsedDsn.dsnPublicKey,
      environment: dsnCache.environment,
      receivedAt: new Date().toISOString(),
      // Per-entry entryId assigned here (not by the caller) so every log
      // line has a stable idempotency key before it ever touches RabbitMQ -
      // without it, a retry/redelivery of this same batch message would
      // insert duplicate log rows in issue-service (matches the pattern
      // transactionId/eventId already give the other two ingestion types).
      logs: logs.map((log) => ({
        ...log,
        entryId: crypto.randomUUID(),
        environment: log.environment || dsnCache.environment,
      })),
    },
  };

  await publishEvent(EventTypes.LOGS_INGESTED, envelope);
  logger.info(
    `Published ${EventTypes.LOGS_INGESTED} ${batchId} (${logs.length} entries) for project ${envelope.data.projectId}`,
  );

  return envelope;
};

module.exports = {
  EventTypes,
  publishEventIngested,
  publishTransactionIngested,
  publishLogsIngested,
};
