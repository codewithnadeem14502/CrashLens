const ProcessedEvent = require("../models/processed-event-model");
const { publishOccurrenceDetected } = require("../events/occurrence-publisher");
const { processOccurrence } = require("../processors/occurrence-processor");
const {
  ProcessingStatus,
  QueueConfig,
  ValidationError,
} = require("../utils/constants");
const logger = require("../utils/logger");
const {
  consumeEventIngested,
  getRetryCount,
  sendToDlq,
  sendToRetryQueue,
} = require("../utils/rabbitmq");
const { validateEventEnvelope } = require("../utils/validation");

const parseMessage = (msg) => {
  try {
    return JSON.parse(msg.content.toString());
  } catch (error) {
    throw new ValidationError("Malformed JSON payload", [error.message]);
  }
};

const reserveProcessing = async (envelope) => {
  const existing = await ProcessedEvent.findOne({ sourceEventId: envelope.eventId });

  if (existing?.status === ProcessingStatus.PROCESSED) {
    return { duplicate: true, record: existing };
  }

  if (existing) {
    existing.status = ProcessingStatus.PROCESSING;
    existing.attempts += 1;
    existing.lastError = undefined;
    existing.projectId = envelope.data.projectId;
    existing.organizationId = envelope.data.organizationId;
    existing.ingestionId = envelope.data.ingestionId;
    await existing.save();
    return { duplicate: false, record: existing };
  }

  const record = await ProcessedEvent.create({
    sourceEventId: envelope.eventId,
    ingestionId: envelope.data.ingestionId,
    projectId: envelope.data.projectId,
    organizationId: envelope.data.organizationId,
    status: ProcessingStatus.PROCESSING,
    attempts: 1,
  });

  return { duplicate: false, record };
};

const markProcessed = async ({ record, occurrence, outputEnvelope }) => {
  record.status = ProcessingStatus.PROCESSED;
  record.fingerprint = occurrence.fingerprint;
  record.outputEventId = outputEnvelope.eventId;
  record.processedAt = new Date();
  record.lastError = undefined;
  await record.save();
};

const markFailed = async ({ record, error }) => {
  if (!record) {
    return;
  }

  record.status = ProcessingStatus.FAILED;
  record.lastError = error.message;
  await record.save();
};

const handleFailure = async ({ envelope, msg, channel, error, record }) => {
  await markFailed({ record, error });

  const retryCount = getRetryCount(msg);
  const shouldDlq =
    error.isPoison || retryCount >= QueueConfig.MAX_RETRY_ATTEMPTS;

  if (shouldDlq) {
    await sendToDlq(
      envelope || {
        rawPayload: msg.content.toString(),
      },
      msg,
      error.details ? `${error.message}: ${error.details.join("; ")}` : error.message,
    );
    channel.ack(msg);
    return;
  }

  await sendToRetryQueue(envelope, msg, error.message);
  channel.ack(msg);
};

const handleMessage = async (msg, channel) => {
  let envelope;
  let record;

  try {
    envelope = parseMessage(msg);
    validateEventEnvelope(envelope);

    logger.info(
      `Consumed event.ingested ${envelope.eventId} for project ${envelope.data.projectId}`,
    );

    const reservation = await reserveProcessing(envelope);
    record = reservation.record;

    if (reservation.duplicate) {
      logger.info(`Skipping duplicate processed event ${envelope.eventId}`);
      channel.ack(msg);
      return;
    }

    const occurrence = processOccurrence(envelope);

    logger.info(
      `Generated fingerprint ${occurrence.fingerprint} and severity ${occurrence.severity} for event ${envelope.eventId}`,
    );

    const outputEnvelope = await publishOccurrenceDetected(occurrence);
    await markProcessed({ record, occurrence, outputEnvelope });
    channel.ack(msg);
  } catch (error) {
    logger.error(
      `Worker failed to process message ${envelope?.eventId || "unknown"}: ${error.message}`,
    );
    await handleFailure({ envelope, msg, channel, error, record });
  }
};

const startEventIngestedConsumer = async () => {
  await consumeEventIngested(handleMessage);
};

module.exports = {
  startEventIngestedConsumer,
};
