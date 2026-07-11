const crypto = require("crypto");
const logger = require("../utils/logger");
const { publishEvent, sendToDlq } = require("../utils/rabbitmq");
const { QueueConfig } = require("../utils/constants");

const EventTypes = Object.freeze({
  PROJECT_CREATED: "project.created",
  PROJECT_UPDATED: "project.updated",
  PROJECT_ARCHIVED: "project.archived",
  PROJECT_DSN_REGENERATED: "project.dsn.regenerated",
});

const buildEnvelope = ({ eventType, data }) => ({
  eventId: crypto.randomUUID(),
  eventType,
  schemaVersion: 1,
  producer: "project-service",
  occurredAt: new Date().toISOString(),
  data,
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Publish failures used to be swallowed here (logged, then dropped) - a
// project.created/updated/archived/dsn.regenerated event could silently
// never reach event-service's DsnCache sync consumer if the broker had a
// blip, with nothing durable left behind to notice or replay it from.
//
// This retries the publish itself (worker-service/issue-service's
// retry-queue+DLX pattern is built for redelivering a *consumed* message
// back to a consumer loop; there's no consumer loop here to redeliver into
// - this is the outbound side, so the direct analog is retrying the publish
// attempt itself), then falls back to a durable DLQ if every attempt fails,
// so the event is never silently lost even in that worst case.
const publishProjectEvent = async ({ eventType, data }) => {
  const envelope = buildEnvelope({ eventType, data });

  let lastError;

  for (let attempt = 1; attempt <= QueueConfig.MAX_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await publishEvent(eventType, envelope);
      return envelope;
    } catch (error) {
      lastError = error;
      logger.warn(
        `Publish attempt ${attempt}/${QueueConfig.MAX_RETRY_ATTEMPTS} failed for ${eventType} (project ${data.projectId}): ${error.message}`,
      );

      if (attempt < QueueConfig.MAX_RETRY_ATTEMPTS) {
        await delay(QueueConfig.RETRY_DELAY_MS * attempt);
      }
    }
  }

  logger.error(
    `Exhausted ${QueueConfig.MAX_RETRY_ATTEMPTS} publish attempts for ${eventType} (project ${data.projectId}): ${lastError.message}`,
  );

  try {
    await sendToDlq(envelope, eventType, lastError.message);
  } catch (dlqError) {
    logger.error(
      `Failed to send ${eventType} (project ${data.projectId}) to DLQ after exhausting retries: ${dlqError.message}`,
    );
  }

  return envelope;
};

const publishProjectCreated = (project) =>
  publishProjectEvent({
    eventType: EventTypes.PROJECT_CREATED,
    data: {
      projectId: project._id.toString(),
      organizationId: project.organizationId.toString(),
      dsnPublicKey: project.dsnPublicKey,
      status: project.status,
      environment: project.environment,
    },
  });

const publishProjectUpdated = (project) =>
  publishProjectEvent({
    eventType: EventTypes.PROJECT_UPDATED,
    data: {
      projectId: project._id.toString(),
      organizationId: project.organizationId.toString(),
      dsnPublicKey: project.dsnPublicKey,
      status: project.status,
      environment: project.environment,
    },
  });

const publishProjectArchived = (project) =>
  publishProjectEvent({
    eventType: EventTypes.PROJECT_ARCHIVED,
    data: {
      projectId: project._id.toString(),
      organizationId: project.organizationId.toString(),
      dsnPublicKey: project.dsnPublicKey,
      status: project.status,
      archivedAt: project.archivedAt,
    },
  });

const publishProjectDsnRegenerated = ({ project, oldDsnPublicKey }) =>
  publishProjectEvent({
    eventType: EventTypes.PROJECT_DSN_REGENERATED,
    data: {
      projectId: project._id.toString(),
      organizationId: project.organizationId.toString(),
      oldDsnPublicKey,
      newDsnPublicKey: project.dsnPublicKey,
      status: project.status,
      environment: project.environment,
    },
  });

module.exports = {
  EventTypes,
  publishProjectArchived,
  publishProjectCreated,
  publishProjectDsnRegenerated,
  publishProjectUpdated,
};
