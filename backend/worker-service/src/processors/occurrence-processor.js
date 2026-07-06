const { buildCulprit, extractTopFrame } = require("./stack-processor");
const { calculateSeverity } = require("./severity-processor");
const { generateFingerprint } = require("./fingerprint-processor");
const { normalizeMessage } = require("../utils/normalization");

const processOccurrence = (envelope) => {
  const { data } = envelope;
  const { event } = data;
  const environment = event.environment || data.environment;
  const normalizedMessage = normalizeMessage(event.message);
  const topFrame = extractTopFrame(event.stack);
  const culprit = buildCulprit(topFrame);
  const fingerprintResult = generateFingerprint({
    projectId: data.projectId,
    environment,
    event,
    normalizedMessage,
    culprit,
  });
  const severity = calculateSeverity({ event, normalizedMessage });
  const processedAt = new Date().toISOString();

  return {
    sourceEventId: envelope.eventId,
    ingestionId: data.ingestionId,
    projectId: data.projectId,
    organizationId: data.organizationId,
    environment,
    release: event.release,
    ...fingerprintResult,
    type: event.type,
    errorName: event.errorName,
    message: event.message,
    normalizedMessage,
    stackTrace: event.stack,
    topFrame,
    culprit,
    severity,
    runtime: event.runtime,
    server: event.server,
    request: event.request,
    occurredAt: event.timestamp,
    receivedAt: data.receivedAt,
    processedAt,
  };
};

module.exports = {
  processOccurrence,
};
