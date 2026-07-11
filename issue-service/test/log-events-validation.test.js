const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateLogsEnvelope } = require("../src/events/log-events");
const { MAX_LOGS_PER_BATCH } = require("../src/models/issue-model");
const { EventTypes } = require("../src/utils/constants");

// Defense-in-depth regression test, same reasoning as
// performance-events-validation.test.js: event-service's Joi schema caps
// batch size and level at ingestion time, but this consumer trusts
// whatever's actually on the queue - a message crafted/replayed directly
// onto RabbitMQ must still be rejected here, before ever reaching the DB.
const validEnvelope = (dataOverrides = {}) => ({
  eventType: EventTypes.LOGS_INGESTED,
  data: {
    batchId: "batch-1",
    projectId: "507f1f77bcf86cd799439011",
    organizationId: "507f1f77bcf86cd799439022",
    logs: [
      {
        entryId: "entry-1",
        level: "info",
        message: "hello",
        timestamp: new Date().toISOString(),
      },
    ],
    ...dataOverrides,
  },
});

test("rejects a logs array longer than MAX_LOGS_PER_BATCH", () => {
  const tooMany = Array.from({ length: MAX_LOGS_PER_BATCH + 1 }, (_, i) => ({
    entryId: `entry-${i}`,
    level: "info",
    message: "hi",
  }));

  assert.throws(
    () => validateLogsEnvelope(validEnvelope({ logs: tooMany })),
    (error) => error.details.some((detail) => /at most/.test(detail)),
  );
});

test("accepts a logs array at exactly MAX_LOGS_PER_BATCH", () => {
  const exactlyMax = Array.from({ length: MAX_LOGS_PER_BATCH }, (_, i) => ({
    entryId: `entry-${i}`,
    level: "info",
    message: "hi",
    timestamp: new Date().toISOString(),
  }));

  assert.doesNotThrow(() => validateLogsEnvelope(validEnvelope({ logs: exactlyMax })));
});

test("rejects a non-array logs field", () => {
  assert.throws(
    () => validateLogsEnvelope(validEnvelope({ logs: "not-an-array" })),
    (error) => error.details.some((detail) => /logs must be a non-empty array/.test(detail)),
  );
});

test("rejects an empty logs array", () => {
  assert.throws(
    () => validateLogsEnvelope(validEnvelope({ logs: [] })),
    (error) => error.details.some((detail) => /logs must be a non-empty array/.test(detail)),
  );
});

test("rejects a log entry with an invalid level", () => {
  assert.throws(
    () =>
      validateLogsEnvelope(
        validEnvelope({
          logs: [{ entryId: "entry-1", level: "verbose", message: "hi" }],
        }),
      ),
    (error) => error.details.some((detail) => /level must be one of/.test(detail)),
  );
});

test("rejects a log entry missing entryId (would break upsert idempotency)", () => {
  assert.throws(
    () =>
      validateLogsEnvelope(
        validEnvelope({ logs: [{ level: "info", message: "hi" }] }),
      ),
    (error) => error.details.some((detail) => /entryId is required/.test(detail)),
  );
});

test("rejects an invalid projectId", () => {
  assert.throws(
    () => validateLogsEnvelope(validEnvelope({ projectId: "not-an-object-id" })),
    (error) => error.details.some((detail) => /projectId is invalid/.test(detail)),
  );
});

// Module 7 review fix: event-service's Joi schema caps context size too,
// but this consumer trusts whatever's on the queue - a message crafted
// directly onto RabbitMQ must still be rejected here.
test("rejects a log entry with an oversized context", () => {
  assert.throws(
    () =>
      validateLogsEnvelope(
        validEnvelope({
          logs: [
            {
              entryId: "entry-1",
              level: "info",
              message: "hi",
              context: { blob: "x".repeat(3000) },
            },
          ],
        }),
      ),
    (error) => error.details.some((detail) => /context exceeds the maximum size/.test(detail)),
  );
});
