const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { LogEntry, MAX_LOG_CONTEXT_BYTES } = require("../src/models/issue-model");
const { processLogsBatch } = require("../src/events/log-events");

// Module 7 (Logs): mirrors the Module 6 pattern (performance-transaction-
// spans.test.js) of proving both the model-layer caps AND the real
// persistence path (processLogsBatch, via updateOne+upsert) actually
// enforce them - runValidators is opt-in on Mongoose updateOne/upsert, so a
// model-only test wouldn't catch a regression in the consumer's write path.
const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/crashlens-issue-service-test";

const baseEntry = (overrides = {}) => ({
  entryId: `entry-${Math.random().toString(36).slice(2)}`,
  projectId: "507f1f77bcf86cd799439011",
  organizationId: "507f1f77bcf86cd799439022",
  level: "info",
  message: "hello world",
  occurredAt: new Date(),
  ...overrides,
});

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

test("rejects an invalid level", async () => {
  const doc = new LogEntry(baseEntry({ level: "verbose" }));
  await assert.rejects(() => doc.validate());
});

test("rejects context exceeding the size cap", async () => {
  const doc = new LogEntry(
    baseEntry({ context: { blob: "x".repeat(MAX_LOG_CONTEXT_BYTES) } }),
  );
  await assert.rejects(() => doc.validate(), /context exceeds the maximum size/);
});

test("accepts a well-formed entry", async () => {
  const doc = new LogEntry(baseEntry({ context: { requestId: "req-1" } }));
  await assert.doesNotReject(() => doc.validate());
});

test("entryId has a unique index", () => {
  const indexes = LogEntry.schema.indexes();
  const uniqueEntryId = indexes.some(
    ([fields, options]) => fields.entryId === 1 && options.unique === true,
  );
  assert.ok(uniqueEntryId, "expected a unique index on entryId");
});

test("has a TTL index bounding retention", () => {
  const indexes = LogEntry.schema.indexes();
  const ttlIndex = indexes.find(
    ([fields]) => Object.keys(fields).length === 1 && fields.expiresAt === 1,
  );

  assert.ok(ttlIndex, "expected a single-field index on expiresAt");
  const [, options] = ttlIndex;
  // expiresAt is pre-computed at insert time (LOG_ENTRY_TTL_SECONDS from
  // now), so expireAfterSeconds is correctly 0 here - "expire exactly when
  // the stored date arrives" - same as ProcessedOccurrence's expiresAt
  // index, not the DsnCache-style "N seconds after this timestamp" pattern.
  assert.equal(options.expireAfterSeconds, 0);
});

test("has a compound (organizationId, projectId, occurredAt) index", () => {
  const indexes = LogEntry.schema.indexes();
  const compound = indexes.some(
    ([fields]) =>
      fields.organizationId === 1 &&
      fields.projectId === 1 &&
      fields.occurredAt === -1 &&
      Object.keys(fields).length === 3,
  );
  assert.ok(compound, "expected the time-range list index");
});

test("has a compound (organizationId, projectId, level, occurredAt) index", () => {
  const indexes = LogEntry.schema.indexes();
  const compound = indexes.some(
    ([fields]) =>
      fields.organizationId === 1 &&
      fields.projectId === 1 &&
      fields.level === 1 &&
      fields.occurredAt === -1,
  );
  assert.ok(compound, "expected the level-filtered list index");
});

test("has a text index on message", () => {
  const indexes = LogEntry.schema.indexes();
  const textIndex = indexes.some(([fields]) => fields.message === "text");
  assert.ok(textIndex, "expected a text index on message");
});

test("processLogsBatch persists a well-formed batch and is idempotent on entryId", async () => {
  const entryId = "entry-idempotency-test";

  await processLogsBatch({
    batchId: "batch-1",
    projectId: "507f1f77bcf86cd799439011",
    organizationId: "507f1f77bcf86cd799439022",
    environment: "production",
    receivedAt: new Date().toISOString(),
    logs: [
      {
        entryId,
        level: "warn",
        message: "disk usage high",
        timestamp: new Date().toISOString(),
      },
    ],
  });

  // Simulates a RabbitMQ redelivery of the same batch message - must not
  // create a second row.
  await processLogsBatch({
    batchId: "batch-1",
    projectId: "507f1f77bcf86cd799439011",
    organizationId: "507f1f77bcf86cd799439022",
    environment: "production",
    receivedAt: new Date().toISOString(),
    logs: [
      {
        entryId,
        level: "warn",
        message: "disk usage high",
        timestamp: new Date().toISOString(),
      },
    ],
  });

  const matches = await LogEntry.find({ entryId });
  assert.equal(matches.length, 1);
});

test("processLogsBatch enforces the context size cap via runValidators and never persists an invalid entry", async () => {
  const entryId = "entry-oversized-context";

  await assert.rejects(() =>
    processLogsBatch({
      batchId: "batch-2",
      projectId: "507f1f77bcf86cd799439011",
      organizationId: "507f1f77bcf86cd799439022",
      environment: "production",
      receivedAt: new Date().toISOString(),
      logs: [
        {
          entryId,
          level: "error",
          message: "boom",
          timestamp: new Date().toISOString(),
          context: { blob: "x".repeat(MAX_LOG_CONTEXT_BYTES) },
        },
      ],
    }),
  );

  const stored = await LogEntry.findOne({ entryId });
  assert.equal(stored, null, "an invalid log entry must never be persisted, even via upsert");
});

// Module 7 review fix: one bad entry in a batch used to poison the whole
// message for retry/DLQ purposes (Promise.all rejects on the first
// failure, so the consumer had no way to know which of the batch's up-to-50
// entries actually failed vs. succeeded). Promise.allSettled + a
// LogBatchPartialFailureError carrying only the failed entries fixes this.
test("a batch with one bad entry among several good ones still persists the good ones, and the thrown error identifies only the bad entry", async () => {
  const goodEntryId1 = "entry-partial-good-1";
  const goodEntryId2 = "entry-partial-good-2";
  const badEntryId = "entry-partial-bad";

  let thrown;
  try {
    await processLogsBatch({
      batchId: "batch-partial",
      projectId: "507f1f77bcf86cd799439011",
      organizationId: "507f1f77bcf86cd799439022",
      environment: "production",
      receivedAt: new Date().toISOString(),
      logs: [
        { entryId: goodEntryId1, level: "info", message: "ok 1", timestamp: new Date().toISOString() },
        {
          entryId: badEntryId,
          level: "error",
          message: "boom",
          timestamp: new Date().toISOString(),
          context: { blob: "x".repeat(MAX_LOG_CONTEXT_BYTES) },
        },
        { entryId: goodEntryId2, level: "warn", message: "ok 2", timestamp: new Date().toISOString() },
      ],
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "expected processLogsBatch to throw");
  assert.equal(thrown.failedEntries.length, 1);
  assert.equal(thrown.failedEntries[0].entryId, badEntryId);
  assert.equal(thrown.isPoison, true, "an oversized-context failure is a pure validation failure");

  const [good1, good2, bad] = await Promise.all([
    LogEntry.findOne({ entryId: goodEntryId1 }),
    LogEntry.findOne({ entryId: goodEntryId2 }),
    LogEntry.findOne({ entryId: badEntryId }),
  ]);

  assert.ok(good1, "the first good entry must still be persisted");
  assert.ok(good2, "the second good entry must still be persisted");
  assert.equal(bad, null, "the bad entry must never be persisted");
});
