const DsnCache = require("../models/dsn-cache-model");
const logger = require("../utils/logger");
const { consumeQueue } = require("../utils/rabbitmq");

const PROJECT_SYNC_QUEUE = "event-service.project-sync";

const ProjectEventTypes = Object.freeze({
  PROJECT_CREATED: "project.created",
  PROJECT_UPDATED: "project.updated",
  PROJECT_ARCHIVED: "project.archived",
  PROJECT_DSN_REGENERATED: "project.dsn.regenerated",
});

const PROJECT_ROUTING_KEYS = Object.values(ProjectEventTypes);

const upsertDsnCache = async (data) => {
  const cacheEntry = await DsnCache.findOneAndUpdate(
    {
      projectId: data.projectId,
      dsnPublicKey: data.dsnPublicKey,
    },
    {
      projectId: data.projectId,
      organizationId: data.organizationId,
      dsnPublicKey: data.dsnPublicKey,
      status: data.status,
      environment: data.environment,
      lastSyncedAt: new Date(),
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  logger.info(
    `Upserted DSN cache ${cacheEntry._id} for project ${data.projectId} with status ${cacheEntry.status}`,
  );
};

const handleProjectEvent = async (message) => {
  const { eventType, data } = message;

  if (!eventType || !data) {
    logger.warn("Ignoring project event with missing eventType or data");
    return;
  }

  logger.info(`Processing project event ${eventType} for project ${data.projectId}`);

  if (
    eventType === ProjectEventTypes.PROJECT_CREATED ||
    eventType === ProjectEventTypes.PROJECT_UPDATED ||
    eventType === ProjectEventTypes.PROJECT_ARCHIVED
  ) {
    await upsertDsnCache(data);
    logger.info(`Synced DSN cache for project ${data.projectId}`);
    return;
  }

  if (eventType === ProjectEventTypes.PROJECT_DSN_REGENERATED) {
    const deleteResult = await DsnCache.deleteOne({
      projectId: data.projectId,
      dsnPublicKey: data.oldDsnPublicKey,
    });

    logger.info(
      `Removed ${deleteResult.deletedCount} old DSN cache entries for project ${data.projectId}`,
    );

    await upsertDsnCache({
      ...data,
      dsnPublicKey: data.newDsnPublicKey,
    });

    logger.info(`Regenerated DSN cache for project ${data.projectId}`);
    return;
  }

  logger.warn(`Ignoring unsupported project event ${eventType}`);
};

const startProjectEventConsumer = async () => {
  logger.info(`Starting project sync consumer on queue ${PROJECT_SYNC_QUEUE}`);
  await consumeQueue(PROJECT_SYNC_QUEUE, PROJECT_ROUTING_KEYS, handleProjectEvent);
};

module.exports = {
  ProjectEventTypes,
  startProjectEventConsumer,
};
