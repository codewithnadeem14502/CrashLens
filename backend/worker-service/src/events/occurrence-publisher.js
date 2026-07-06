const crypto = require("crypto");
const { EventTypes, Producers } = require("../utils/constants");
const { publishEvent } = require("../utils/rabbitmq");
const logger = require("../utils/logger");

const publishOccurrenceDetected = async (occurrence) => {
  const envelope = {
    eventId: `worker_evt_${crypto.randomUUID()}`,
    eventType: EventTypes.ISSUE_OCCURRENCE_DETECTED,
    schemaVersion: 1,
    producer: Producers.WORKER_SERVICE,
    occurredAt: new Date().toISOString(),
    data: occurrence,
  };

  await publishEvent(EventTypes.ISSUE_OCCURRENCE_DETECTED, envelope);

  logger.info(
    `Published ${EventTypes.ISSUE_OCCURRENCE_DETECTED} for source ${occurrence.sourceEventId}, project ${occurrence.projectId}, fingerprint ${occurrence.fingerprint}`,
  );

  return envelope;
};

module.exports = {
  publishOccurrenceDetected,
};
