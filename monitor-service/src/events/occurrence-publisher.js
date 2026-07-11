const crypto = require("crypto");
const logger = require("../utils/logger");
const { publishEvent, sendToDlq } = require("../utils/rabbitmq");
const { EventTypes, QueueConfig } = require("../utils/constants");

const buildEnvelope = (data) => ({
  eventId: crypto.randomUUID(),
  eventType: EventTypes.ISSUE_OCCURRENCE_DETECTED,
  schemaVersion: 1,
  producer: "monitor-service",
  occurredAt: new Date().toISOString(),
  data,
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same publisher-side retry+DLQ pattern as project-service's
// publishProjectEvent (see that file's comment for why this differs from
// the consumer-side retry-queue+DLX pattern) - this is the only thing
// standing between a missed-checkin/uptime-down signal and it silently
// never reaching issue-service if RabbitMQ has a blip, so it must not
// swallow failures.
const publishOccurrence = async (occurrence) => {
  const envelope = buildEnvelope(occurrence);

  let lastError;

  for (let attempt = 1; attempt <= QueueConfig.MAX_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await publishEvent(EventTypes.ISSUE_OCCURRENCE_DETECTED, envelope);
      return envelope;
    } catch (error) {
      lastError = error;
      logger.warn(
        `Publish attempt ${attempt}/${QueueConfig.MAX_RETRY_ATTEMPTS} failed for occurrence ${occurrence.sourceEventId}: ${error.message}`,
      );

      if (attempt < QueueConfig.MAX_RETRY_ATTEMPTS) {
        await delay(QueueConfig.RETRY_DELAY_MS * attempt);
      }
    }
  }

  logger.error(
    `Exhausted ${QueueConfig.MAX_RETRY_ATTEMPTS} publish attempts for occurrence ${occurrence.sourceEventId}: ${lastError.message}`,
  );

  try {
    await sendToDlq(envelope, EventTypes.ISSUE_OCCURRENCE_DETECTED, lastError.message);
  } catch (dlqError) {
    logger.error(
      `Failed to send occurrence ${occurrence.sourceEventId} to DLQ after exhausting retries: ${dlqError.message}`,
    );
  }

  return envelope;
};

module.exports = {
  publishOccurrence,
};
