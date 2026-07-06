const crypto = require("crypto");
const { publishEvent } = require("../utils/rabbitmq");
const logger = require("../utils/logger");

const EventTypes = Object.freeze({
  EVENT_INGESTED: "event.ingested",
});

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

module.exports = {
  EventTypes,
  publishEventIngested,
};
