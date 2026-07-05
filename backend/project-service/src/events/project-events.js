const crypto = require("crypto");
const logger = require("../utils/logger");
const { publishEvent } = require("../utils/rabbitmq");

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

const publishProjectEvent = async ({ eventType, data }) => {
  const envelope = buildEnvelope({ eventType, data });

  try {
    await publishEvent(eventType, envelope);
  } catch (error) {
    logger.error(
      `Failed to publish ${eventType} for project ${data.projectId}: ${error.message}`,
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
