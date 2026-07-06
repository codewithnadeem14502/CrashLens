const mongoose = require("mongoose");
const {
  Environments,
  EventKinds,
  EventTypes,
  Producers,
  ValidationError,
} = require("./constants");

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isIsoDate = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
};

const requireString = (value, path, errors) => {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} is required`);
  }
};

const validateEventEnvelope = (envelope) => {
  const errors = [];

  if (!isPlainObject(envelope)) {
    throw new ValidationError("Invalid event envelope", [
      "message must be a JSON object",
    ]);
  }

  requireString(envelope.eventId, "eventId", errors);

  if (envelope.eventType !== EventTypes.EVENT_INGESTED) {
    errors.push(`eventType must be ${EventTypes.EVENT_INGESTED}`);
  }

  if (envelope.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1");
  }

  if (envelope.producer !== Producers.EVENT_SERVICE) {
    errors.push(`producer must be ${Producers.EVENT_SERVICE}`);
  }

  if (!isIsoDate(envelope.occurredAt)) {
    errors.push("occurredAt must be a valid ISO date");
  }

  if (!isPlainObject(envelope.data)) {
    errors.push("data is required");
  }

  const data = envelope.data || {};
  requireString(data.ingestionId, "data.ingestionId", errors);

  if (!mongoose.Types.ObjectId.isValid(data.projectId)) {
    errors.push("data.projectId must be a valid Mongo ObjectId");
  }

  if (!mongoose.Types.ObjectId.isValid(data.organizationId)) {
    errors.push("data.organizationId must be a valid Mongo ObjectId");
  }

  if (!Object.values(Environments).includes(data.environment)) {
    errors.push("data.environment must be development, staging, or production");
  }

  if (!isIsoDate(data.receivedAt)) {
    errors.push("data.receivedAt must be a valid ISO date");
  }

  if (!isPlainObject(data.event)) {
    errors.push("data.event is required");
  }

  const event = data.event || {};

  if (!Object.values(EventKinds).includes(event.type)) {
    errors.push("data.event.type must be exception or message");
  }

  requireString(event.message, "data.event.message", errors);

  if (!isIsoDate(event.timestamp)) {
    errors.push("data.event.timestamp must be a valid ISO date");
  }

  if (event.errorName !== undefined && typeof event.errorName !== "string") {
    errors.push("data.event.errorName must be a string");
  }

  if (event.stack !== undefined && typeof event.stack !== "string") {
    errors.push("data.event.stack must be a string");
  }

  if (
    event.environment !== undefined &&
    !Object.values(Environments).includes(event.environment)
  ) {
    errors.push(
      "data.event.environment must be development, staging, or production",
    );
  }

  if (errors.length) {
    throw new ValidationError("Invalid event.ingested payload", errors);
  }

  return envelope;
};

module.exports = {
  validateEventEnvelope,
};
