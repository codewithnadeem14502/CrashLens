const mongoose = require("mongoose");
const {
  PerformanceTransaction,
  MAX_TRANSACTION_SPANS,
} = require("../models/issue-model");
const {
  Environments,
  EventTypes,
  QueueConfig,
  ValidationError,
} = require("../utils/constants");
const logger = require("../utils/logger");
const {
  consumeTransactionIngested,
  getRetryCount,
  sendTransactionToDlq,
  sendTransactionToRetryQueue,
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

const validateTransactionEnvelope = (envelope) => {
  const errors = [];

  if (!envelope || typeof envelope !== "object") {
    throw new ValidationError("Invalid transaction envelope", [
      "payload must be an object",
    ]);
  }

  if (envelope.eventType !== EventTypes.TRANSACTION_INGESTED) {
    errors.push(`eventType must be ${EventTypes.TRANSACTION_INGESTED}`);
  }

  const data = envelope.data || {};
  const transaction = data.transaction || {};

  requireString(data, "transactionId", errors);
  requireString(data, "projectId", errors);
  requireString(data, "organizationId", errors);
  requireString(transaction, "method", errors);
  requireString(transaction, "route", errors);

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

  if (!Number.isFinite(transaction.durationMs) || transaction.durationMs < 0) {
    errors.push("transaction.durationMs must be a non-negative number");
  }

  if (
    !Number.isInteger(transaction.statusCode) ||
    transaction.statusCode < 100 ||
    transaction.statusCode > 599
  ) {
    errors.push("transaction.statusCode must be an HTTP status code");
  }

  if (
    transaction.timestamp &&
    Number.isNaN(new Date(transaction.timestamp).getTime())
  ) {
    errors.push("transaction.timestamp must be a valid date");
  }

  // Defense in depth: event-service's Joi schema already caps spans at
  // ingestion time, but this consumer trusts whatever's on the queue -
  // a message crafted/replayed directly onto RabbitMQ (bypassing
  // event-service entirely) would otherwise sail through untouched. Fail
  // fast here (before the DB round-trip) rather than relying solely on the
  // model-level validator in processTransaction to catch it.
  if (
    transaction.spans !== undefined &&
    (!Array.isArray(transaction.spans) ||
      transaction.spans.length > MAX_TRANSACTION_SPANS)
  ) {
    errors.push(`transaction.spans must be an array of at most ${MAX_TRANSACTION_SPANS} items`);
  }

  if (errors.length) {
    throw new ValidationError("Invalid transaction payload", errors);
  }
};

const processTransaction = async (payload) => {
  const transaction = payload.transaction;
  const occurredAt = toDate(transaction.timestamp, toDate(payload.receivedAt));

  await PerformanceTransaction.updateOne(
    { transactionId: payload.transactionId },
    {
      $setOnInsert: {
        transactionId: payload.transactionId,
        ingestionId: payload.ingestionId,
        projectId: payload.projectId,
        organizationId: payload.organizationId,
        name: transaction.name || `${transaction.method} ${transaction.route}`,
        method: transaction.method,
        route: transaction.route,
        url: transaction.url,
        durationMs: transaction.durationMs,
        statusCode: transaction.statusCode,
        traceId: transaction.traceId,
        spanId: transaction.spanId,
        spans: transaction.spans || [],
        tags: transaction.tags,
        release: transaction.release,
        environment: payload.environment || transaction.environment,
        occurredAt,
        receivedAt: toDate(payload.receivedAt, occurredAt),
        processedAt: new Date(),
      },
    },
    // runValidators: Mongoose does NOT run schema validators on
    // updateOne/findOneAndUpdate by default, even with upsert:true - without
    // this, the spans-array-length and per-span data-size validators added
    // to the model would silently never run for this write path (the only
    // path transactions are ever persisted through).
    { upsert: true, runValidators: true, context: "query" },
  );
};

const handleFailure = async ({ envelope, msg, channel, error }) => {
  const retryCount = getRetryCount(msg);
  const shouldDlq =
    error.isPoison || retryCount >= QueueConfig.MAX_RETRY_ATTEMPTS;
  const reason = error.details
    ? `${error.message}: ${error.details.join("; ")}`
    : error.message;

  if (shouldDlq) {
    await sendTransactionToDlq(
      envelope || { rawPayload: msg.content.toString() },
      msg,
      reason,
    );
    channel.ack(msg);
    return;
  }

  await sendTransactionToRetryQueue(envelope, msg, error.message);
  channel.ack(msg);
};

const handleMessage = async (msg, channel) => {
  let envelope;

  try {
    envelope = parseMessage(msg);
    validateTransactionEnvelope(envelope);

    logger.info(
      `Consumed ${EventTypes.TRANSACTION_INGESTED} ${envelope.data.transactionId} for project ${envelope.data.projectId}`,
    );

    await processTransaction(envelope.data);
    logger.info(`Stored transaction ${envelope.data.transactionId}`);
    channel.ack(msg);
  } catch (error) {
    logger.error(
      `Issue-service failed to process transaction ${envelope?.data?.transactionId || "unknown"}: ${error.message}`,
    );
    await handleFailure({ envelope, msg, channel, error });
  }
};

const startTransactionConsumer = async () => {
  await consumeTransactionIngested(handleMessage);
};

module.exports = {
  startTransactionConsumer,
  validateTransactionEnvelope,
  processTransaction,
};
