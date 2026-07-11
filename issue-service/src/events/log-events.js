const mongoose = require("mongoose");
const {
  LogEntry,
  MAX_LOGS_PER_BATCH,
  MAX_LOG_CONTEXT_BYTES,
} = require("../models/issue-model");
const {
  Environments,
  EventTypes,
  LogLevel,
  QueueConfig,
  ValidationError,
} = require("../utils/constants");
const logger = require("../utils/logger");
const {
  consumeLogsIngested,
  getRetryCount,
  sendLogsToDlq,
  sendLogsToRetryQueue,
} = require("../utils/rabbitmq");

const parseMessage = (msg) => {
  try {
    return JSON.parse(msg.content.toString());
  } catch (error) {
    throw new ValidationError("Malformed JSON payload", [error.message]);
  }
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const requireString = (data, field, errors) => {
  if (!data[field] || typeof data[field] !== "string") {
    errors.push(`${field} is required`);
  }
};

const toDate = (value, fallback = new Date()) => {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const isWithinByteLimit = (value, maxBytes) => {
  if (!value) {
    return true;
  }

  try {
    return JSON.stringify(value).length <= maxBytes;
  } catch {
    return false;
  }
};

const validateLogEntry = (entry, index, errors) => {
  requireString(entry, "entryId", errors);
  requireString(entry, "message", errors);

  if (!Object.values(LogLevel).includes(entry.level)) {
    errors.push(`logs[${index}].level must be one of: ${Object.values(LogLevel).join(", ")}`);
  }

  if (entry.timestamp && Number.isNaN(new Date(entry.timestamp).getTime())) {
    errors.push(`logs[${index}].timestamp must be a valid date`);
  }

  // Same reasoning as MAX_TRANSACTION_SPANS re-checking here: event-service's
  // Joi schema caps context at MAX_LOG_CONTEXT_BYTES too, but this consumer
  // trusts whatever's actually on the queue - a message crafted/replayed
  // directly onto RabbitMQ must still be caught here, marked poison (see
  // handleFailure below), rather than only failing 1-2 hops further down at
  // the Mongoose model validator.
  if (!isWithinByteLimit(entry.context, MAX_LOG_CONTEXT_BYTES)) {
    errors.push(`logs[${index}].context exceeds the maximum size of ${MAX_LOG_CONTEXT_BYTES} bytes`);
  }
};

// Defense in depth, same reasoning as validateTransactionEnvelope: this
// consumer trusts whatever's on the queue, so event-service's Joi cap on
// batch size must be re-checked here too - a message crafted/replayed
// directly onto RabbitMQ would otherwise bypass it entirely.
const validateLogsEnvelope = (envelope) => {
  const errors = [];

  if (!envelope || typeof envelope !== "object") {
    throw new ValidationError("Invalid logs envelope", [
      "payload must be an object",
    ]);
  }

  if (envelope.eventType !== EventTypes.LOGS_INGESTED) {
    errors.push(`eventType must be ${EventTypes.LOGS_INGESTED}`);
  }

  const data = envelope.data || {};

  requireString(data, "batchId", errors);
  requireString(data, "projectId", errors);
  requireString(data, "organizationId", errors);

  if (data.projectId && !isValidObjectId(data.projectId)) {
    errors.push("projectId is invalid");
  }

  if (data.organizationId && !isValidObjectId(data.organizationId)) {
    errors.push("organizationId is invalid");
  }

  if (
    data.environment &&
    !Object.values(Environments).includes(data.environment)
  ) {
    errors.push(
      `environment must be one of: ${Object.values(Environments).join(", ")}`,
    );
  }

  if (!Array.isArray(data.logs) || data.logs.length === 0) {
    errors.push("logs must be a non-empty array");
  } else if (data.logs.length > MAX_LOGS_PER_BATCH) {
    errors.push(`logs must contain at most ${MAX_LOGS_PER_BATCH} entries`);
  } else {
    data.logs.forEach((entry, index) => validateLogEntry(entry, index, errors));
  }

  if (errors.length) {
    throw new ValidationError("Invalid logs payload", errors);
  }
};

const isMongooseValidationFailure = (error) =>
  error instanceof mongoose.Error.ValidationError ||
  error instanceof mongoose.Error.ValidatorError;

// Thrown by processLogsBatch when one or more (but not necessarily all) of
// the batch's entries fail to persist. Carries only the FAILED entries so
// handleFailure can retry/DLQ just that subset instead of the whole
// original message - the batch's other entries are already durably
// persisted (upsert on entryId is idempotent) by the time this throws, so
// re-processing them on every retry would be pure waste and would make DLQ
// triage misleading (a batch landing in the DLQ because 1 of 50 entries was
// oversized looks, from the DLQ alone, like all 50 failed).
class LogBatchPartialFailureError extends Error {
  constructor(failures) {
    super(`${failures.length} of the batch's log entries failed to persist`);
    this.name = "LogBatchPartialFailureError";
    this.failedEntries = failures.map((failure) => failure.entry);
    this.details = failures.map((failure) => failure.message);
    // Only skip straight to DLQ (bypassing the normal retry-count grace
    // period) when every failure is a schema-validation failure - i.e. the
    // entry itself is structurally invalid (oversized context, bad level)
    // and retrying it verbatim would fail identically every time. A mix
    // that includes a non-validation (e.g. transient Mongo) failure still
    // gets the normal retry budget.
    this.isPoison = failures.every((failure) => failure.isValidationFailure);
  }
}

const persistLogEntry = (payload, entry) => {
  const occurredAt = toDate(entry.timestamp, toDate(payload.receivedAt));

  return LogEntry.updateOne(
    { entryId: entry.entryId },
    {
      $setOnInsert: {
        entryId: entry.entryId,
        batchId: payload.batchId,
        ingestionId: payload.ingestionId,
        projectId: payload.projectId,
        organizationId: payload.organizationId,
        level: entry.level,
        message: entry.message,
        logger: entry.logger,
        traceId: entry.traceId,
        correlationId: entry.correlationId,
        context: entry.context,
        release: entry.release,
        environment: entry.environment || payload.environment,
        occurredAt,
        receivedAt: toDate(payload.receivedAt, occurredAt),
        processedAt: new Date(),
      },
    },
    // Same runValidators gap as processTransaction (Module 6) - Mongoose
    // does not run schema validators on updateOne/upsert by default, which
    // would silently skip the context-size and level-enum validators added
    // to the model.
    { upsert: true, runValidators: true, context: "query" },
  );
};

const processLogsBatch = async (payload) => {
  const results = await Promise.allSettled(
    payload.logs.map((entry) => persistLogEntry(payload, entry)),
  );

  const failures = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failures.push({
        entry: payload.logs[index],
        message: result.reason?.message || "Unknown persistence failure",
        isValidationFailure: isMongooseValidationFailure(result.reason),
      });
    }
  });

  if (failures.length) {
    throw new LogBatchPartialFailureError(failures);
  }
};

const handleFailure = async ({ envelope, msg, channel, error }) => {
  const retryCount = getRetryCount(msg);
  const shouldDlq =
    error.isPoison || retryCount >= QueueConfig.MAX_RETRY_ATTEMPTS;
  const reason = error.details
    ? `${error.message}: ${error.details.join("; ")}`
    : error.message;

  // A partial-failure error only re-queues/DLQs the entries that actually
  // failed - the rest of the batch is already durably persisted (idempotent
  // upsert), so retrying/DLQing the full original envelope would silently
  // redo (harmless but wasteful) work and misrepresent the DLQ's contents.
  const failedEnvelope =
    envelope && error.failedEntries
      ? { ...envelope, data: { ...envelope.data, logs: error.failedEntries } }
      : envelope;

  if (shouldDlq) {
    await sendLogsToDlq(
      failedEnvelope || { rawPayload: msg.content.toString() },
      msg,
      reason,
    );
    channel.ack(msg);
    return;
  }

  await sendLogsToRetryQueue(failedEnvelope, msg, error.message);
  channel.ack(msg);
};

const handleMessage = async (msg, channel) => {
  let envelope;

  try {
    envelope = parseMessage(msg);
    validateLogsEnvelope(envelope);

    logger.info(
      `Consumed ${EventTypes.LOGS_INGESTED} ${envelope.data.batchId} (${envelope.data.logs.length} entries) for project ${envelope.data.projectId}`,
    );

    await processLogsBatch(envelope.data);
    logger.info(`Stored log batch ${envelope.data.batchId}`);
    channel.ack(msg);
  } catch (error) {
    logger.error(
      `Issue-service failed to process log batch ${envelope?.data?.batchId || "unknown"}: ${error.message}`,
    );
    await handleFailure({ envelope, msg, channel, error });
  }
};

const startLogsConsumer = async () => {
  await consumeLogsIngested(handleMessage);
};

module.exports = {
  startLogsConsumer,
  validateLogsEnvelope,
  processLogsBatch,
};
