const mongoose = require("mongoose");
const {
  Issue,
  IssueEvent,
  ProcessedOccurrence,
} = require("../models/issue-model");
const {
  Environments,
  EventTypes,
  IssueStatus,
  ProcessingStatus,
  QueueConfig,
  Severity,
  ValidationError,
} = require("../utils/constants");
const logger = require("../utils/logger");
const {
  consumeOccurrenceDetected,
  getRetryCount,
  sendToDlq,
  sendToRetryQueue,
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

const validateOccurrenceEnvelope = (envelope) => {
  const errors = [];

  if (!envelope || typeof envelope !== "object") {
    throw new ValidationError("Invalid occurrence envelope", [
      "payload must be an object",
    ]);
  }

  if (envelope.eventType !== EventTypes.ISSUE_OCCURRENCE_DETECTED) {
    errors.push(`eventType must be ${EventTypes.ISSUE_OCCURRENCE_DETECTED}`);
  }

  const data = envelope.data || {};

  requireString(data, "sourceEventId", errors);
  requireString(data, "projectId", errors);
  requireString(data, "organizationId", errors);
  requireString(data, "fingerprint", errors);
  requireString(data, "message", errors);
  requireString(data, "severity", errors);

  if (data.projectId && !isValidObjectId(data.projectId)) {
    errors.push("projectId is invalid");
  }

  if (data.organizationId && !isValidObjectId(data.organizationId)) {
    errors.push("organizationId is invalid");
  }

  if (data.severity && !Object.values(Severity).includes(data.severity)) {
    errors.push(`severity must be one of: ${Object.values(Severity).join(", ")}`);
  }

  if (
    data.environment &&
    !Object.values(Environments).includes(data.environment)
  ) {
    errors.push(
      `environment must be one of: ${Object.values(Environments).join(", ")}`,
    );
  }

  if (data.occurredAt && Number.isNaN(new Date(data.occurredAt).getTime())) {
    errors.push("occurredAt must be a valid date");
  }

  if (data.receivedAt && Number.isNaN(new Date(data.receivedAt).getTime())) {
    errors.push("receivedAt must be a valid date");
  }

  if (data.processedAt && Number.isNaN(new Date(data.processedAt).getTime())) {
    errors.push("processedAt must be a valid date");
  }

  if (data.message && data.message.length > 2000) {
    errors.push("message cannot exceed 2000 characters");
  }

  if (data.stackTrace && data.stackTrace.length > 50000) {
    errors.push("stackTrace cannot exceed 50000 characters");
  }

  if (errors.length) {
    throw new ValidationError("Invalid occurrence payload", errors);
  }
};

const toDate = (value, fallback = new Date()) => {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const reserveProcessing = async (occurrence) => {
  const existing = await ProcessedOccurrence.findOne({
    sourceEventId: occurrence.sourceEventId,
  });

  if (existing?.status === ProcessingStatus.PROCESSED) {
    return { duplicate: true, record: existing };
  }

  if (existing) {
    existing.status = ProcessingStatus.PROCESSING;
    existing.attempts += 1;
    existing.lastError = undefined;
    existing.projectId = occurrence.projectId;
    existing.organizationId = occurrence.organizationId;
    await existing.save();
    return { duplicate: false, record: existing };
  }

  try {
    const record = await ProcessedOccurrence.create({
      sourceEventId: occurrence.sourceEventId,
      projectId: occurrence.projectId,
      organizationId: occurrence.organizationId,
      status: ProcessingStatus.PROCESSING,
      attempts: 1,
    });

    return { duplicate: false, record };
  } catch (error) {
    if (error.code === 11000) {
      const record = await ProcessedOccurrence.findOne({
        sourceEventId: occurrence.sourceEventId,
      });
      return {
        duplicate: record?.status === ProcessingStatus.PROCESSED,
        record,
      };
    }

    throw error;
  }
};

const findOrCreateIssue = async (occurrence, seenAt) => {
  const filter = {
    organizationId: occurrence.organizationId,
    projectId: occurrence.projectId,
    fingerprint: occurrence.fingerprint,
  };

  const existing = await Issue.findOne(filter);

  if (existing) {
    return existing;
  }

  try {
    return await Issue.create({
      ...filter,
      fingerprintVersion: occurrence.fingerprintVersion || "v1",
      title: occurrence.message,
      message: occurrence.message,
      errorName: occurrence.errorName,
      culprit: occurrence.culprit,
      severity: occurrence.severity,
      status: IssueStatus.UNRESOLVED,
      occurrenceCount: 0,
      firstSeen: seenAt,
      lastSeen: seenAt,
      lastRelease: occurrence.release,
      lastEnvironment: occurrence.environment,
    });
  } catch (error) {
    if (error.code === 11000) {
      return Issue.findOne(filter);
    }

    throw error;
  }
};

const upsertIssueEvent = async ({ issue, occurrence, occurredAt }) => {
  const event = await IssueEvent.findOneAndUpdate(
    { sourceEventId: occurrence.sourceEventId },
    {
      $setOnInsert: {
        issueId: issue._id,
        sourceEventId: occurrence.sourceEventId,
        ingestionId: occurrence.ingestionId,
        projectId: occurrence.projectId,
        organizationId: occurrence.organizationId,
        message: occurrence.message,
        normalizedMessage: occurrence.normalizedMessage,
        errorName: occurrence.errorName,
        stackTrace: occurrence.stackTrace,
        topFrame: occurrence.topFrame,
        request: occurrence.request,
        runtime: occurrence.runtime,
        server: occurrence.server,
        release: occurrence.release,
        environment: occurrence.environment,
        severity: occurrence.severity,
        occurredAt,
        receivedAt: toDate(occurrence.receivedAt, occurredAt),
        processedAt: toDate(occurrence.processedAt, new Date()),
        countedInIssue: false,
      },
    },
    { new: true, upsert: true },
  );

  return event;
};

const incrementIssueIfNeeded = async ({ issue, event, occurrence, seenAt }) => {
  if (event.countedInIssue) {
    return false;
  }

  const update = {
    $inc: { occurrenceCount: 1 },
    $set: {
      title: occurrence.message || issue.title,
      message: occurrence.message || issue.message,
      errorName: occurrence.errorName || issue.errorName,
      culprit: occurrence.culprit || issue.culprit,
      severity: occurrence.severity || issue.severity,
      lastSeen: seenAt,
      lastRelease: occurrence.release,
      lastEnvironment: occurrence.environment,
    },
  };

  if (issue.status === IssueStatus.RESOLVED) {
    update.$set.status = IssueStatus.UNRESOLVED;
    update.$set.regression = true;
    update.$set.reopenedAt = new Date();
    update.$unset = {
      resolvedAt: "",
      resolvedBy: "",
    };
  }

  await Issue.updateOne({ _id: issue._id }, update);
  await IssueEvent.updateOne(
    { _id: event._id },
    { $set: { countedInIssue: true } },
  );
  return true;
};

const markProcessed = async ({ record, issue }) => {
  record.status = ProcessingStatus.PROCESSED;
  record.issueId = issue._id;
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

const processOccurrence = async (occurrence) => {
  const seenAt = toDate(occurrence.occurredAt);
  const issue = await findOrCreateIssue(occurrence, seenAt);
  const event = await upsertIssueEvent({ issue, occurrence, occurredAt: seenAt });
  await incrementIssueIfNeeded({ issue, event, occurrence, seenAt });
  return issue;
};

const handleFailure = async ({ envelope, msg, channel, error, record }) => {
  await markFailed({ record, error });

  const retryCount = getRetryCount(msg);
  const shouldDlq =
    error.isPoison || retryCount >= QueueConfig.MAX_RETRY_ATTEMPTS;

  if (shouldDlq) {
    await sendToDlq(
      envelope || { rawPayload: msg.content.toString() },
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
    validateOccurrenceEnvelope(envelope);

    const occurrence = envelope.data;
    logger.info(
      `Consumed ${EventTypes.ISSUE_OCCURRENCE_DETECTED} for source ${occurrence.sourceEventId}, project ${occurrence.projectId}`,
    );

    const reservation = await reserveProcessing(occurrence);
    record = reservation.record;

    if (reservation.duplicate) {
      logger.info(`Skipping duplicate occurrence ${occurrence.sourceEventId}`);
      channel.ack(msg);
      return;
    }

    const issue = await processOccurrence(occurrence);
    await markProcessed({ record, issue });

    logger.info(
      `Stored occurrence ${occurrence.sourceEventId} on issue ${issue._id}`,
    );
    channel.ack(msg);
  } catch (error) {
    logger.error(
      `Issue-service failed to process occurrence ${envelope?.data?.sourceEventId || "unknown"}: ${error.message}`,
    );
    await handleFailure({ envelope, msg, channel, error, record });
  }
};

const startOccurrenceConsumer = async () => {
  await consumeOccurrenceDetected(handleMessage);
};

module.exports = {
  startOccurrenceConsumer,
};
