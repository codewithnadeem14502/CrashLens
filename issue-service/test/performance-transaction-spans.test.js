const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  PerformanceTransaction,
  MAX_TRANSACTION_SPANS,
} = require("../src/models/issue-model");
const { processTransaction } = require("../src/events/performance-events");

// Regression tests for the Module 6 P1 fix: PerformanceTransaction.spans
// was an unbounded embedded array of unbounded Mixed span data, with
// nothing enforcing bounds at the model layer (only event-service's Joi
// schema capped spans at ingestion time, and even that never bounded each
// span's data field size, and the issue-service consumer that actually
// persists transactions never re-checked either).
const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/crashlens-issue-service-test";

const baseTransaction = (overrides = {}) => ({
  projectId: "507f1f77bcf86cd799439011",
  organizationId: "507f1f77bcf86cd799439022",
  method: "GET",
  route: "/orders/:id",
  durationMs: 42,
  statusCode: 200,
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

test("rejects a spans array longer than MAX_TRANSACTION_SPANS at the model layer", async () => {
  const tooManySpans = Array.from({ length: MAX_TRANSACTION_SPANS + 1 }, (_, i) => ({
    spanId: `span-${i}`,
  }));

  const doc = new PerformanceTransaction(
    baseTransaction({ transactionId: "txn-too-many-spans", spans: tooManySpans }),
  );

  await assert.rejects(() => doc.validate(), /spans array exceeds the maximum/);
});

test("accepts exactly MAX_TRANSACTION_SPANS spans", async () => {
  const exactlyMax = Array.from({ length: MAX_TRANSACTION_SPANS }, (_, i) => ({
    spanId: `span-${i}`,
  }));

  const doc = new PerformanceTransaction(
    baseTransaction({ transactionId: "txn-exactly-max-spans", spans: exactlyMax }),
  );

  await assert.doesNotReject(() => doc.validate());
});

test("rejects a span whose data field exceeds the size limit", async () => {
  const doc = new PerformanceTransaction(
    baseTransaction({
      transactionId: "txn-oversized-span-data",
      spans: [
        {
          spanId: "span-1",
          data: { blob: "x".repeat(4096) },
        },
      ],
    }),
  );

  await assert.rejects(() => doc.validate(), /span data exceeds the maximum size/);
});

test("rejects a span with an oversized spanId/parentSpanId (previously unbounded)", async () => {
  const doc = new PerformanceTransaction(
    baseTransaction({
      transactionId: "txn-oversized-span-id",
      spans: [{ spanId: "x".repeat(500), op: "noop" }],
    }),
  );

  await assert.rejects(() => doc.validate());
});

test("rejects a transaction with oversized tags (previously had no cap anywhere in the pipeline)", async () => {
  const doc = new PerformanceTransaction(
    baseTransaction({
      transactionId: "txn-oversized-tags",
      tags: { blob: "x".repeat(4096) },
    }),
  );

  await assert.rejects(() => doc.validate(), /tags exceeds the maximum size/);
});

test("processTransaction (the real persistence path) enforces the spans cap via runValidators", async () => {
  const tooManySpans = Array.from({ length: MAX_TRANSACTION_SPANS + 5 }, (_, i) => ({
    spanId: `span-${i}`,
  }));

  await assert.rejects(
    () =>
      processTransaction({
        transactionId: "txn-via-consumer-too-many-spans",
        projectId: "507f1f77bcf86cd799439011",
        organizationId: "507f1f77bcf86cd799439022",
        environment: "production",
        transaction: {
          method: "GET",
          route: "/orders/:id",
          durationMs: 42,
          statusCode: 200,
          timestamp: new Date().toISOString(),
          spans: tooManySpans,
        },
      }),
    /spans array exceeds the maximum/,
  );

  const stored = await PerformanceTransaction.findOne({
    transactionId: "txn-via-consumer-too-many-spans",
  });
  assert.equal(stored, null, "an invalid transaction must never be persisted, even via upsert");
});

test("processTransaction succeeds and persists spans within bounds", async () => {
  await processTransaction({
    transactionId: "txn-via-consumer-valid",
    projectId: "507f1f77bcf86cd799439011",
    organizationId: "507f1f77bcf86cd799439022",
    environment: "production",
    transaction: {
      method: "GET",
      route: "/orders/:id",
      durationMs: 42,
      statusCode: 200,
      timestamp: new Date().toISOString(),
      spans: [{ spanId: "span-1", op: "db.query" }],
    },
  });

  const stored = await PerformanceTransaction.findOne({
    transactionId: "txn-via-consumer-valid",
  });
  assert.ok(stored);
  assert.equal(stored.spans.length, 1);
});
