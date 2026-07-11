const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const DsnCache = require("../src/models/dsn-cache-model");
const { closeRabbitMQ } = require("../src/utils/rabbitmq");

process.env.MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/crashlens-event-service-test";

const app = require("../src/app");

// Module 7 (Logs): POST /api/events/logs, the third ingestion route
// alongside the existing error and transaction routes. Mirrors those two
// routes' DSN-authenticated, Joi-validated shape rather than inventing a
// new one - see event-controller.js's ingestLogs/ingestEvent/ingestTransaction.
const TEST_MONGO_URI = process.env.MONGODB_URI;
const PROJECT_ID = "507f1f77bcf86cd799439011";
const ORGANIZATION_ID = "507f1f77bcf86cd799439022";
const DSN_PUBLIC_KEY = "log-ingestion-test-key";
const DSN = `crashlens://${DSN_PUBLIC_KEY}@localhost:3000/${PROJECT_ID}`;

const validLogEntry = (overrides = {}) => ({
  level: "info",
  message: "user checkout completed",
  timestamp: new Date().toISOString(),
  ...overrides,
});

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  await DsnCache.create({
    projectId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    dsnPublicKey: DSN_PUBLIC_KEY,
    status: "active",
    environment: "production",
  });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await closeRabbitMQ();
});

test("rejects a batch with no logs", async () => {
  const res = await request(app)
    .post("/api/events/logs")
    .send({ dsn: DSN, logs: [] });

  assert.equal(res.status, 400);
});

test("rejects a batch exceeding the max batch size", async () => {
  const tooMany = Array.from({ length: 51 }, () => validLogEntry());

  const res = await request(app)
    .post("/api/events/logs")
    .send({ dsn: DSN, logs: tooMany });

  assert.equal(res.status, 400);
});

test("rejects a log entry with an oversized context (Module 7 review fix: enforced at ingestion, not just at the Mongoose layer two hops downstream)", async () => {
  const res = await request(app)
    .post("/api/events/logs")
    .send({
      dsn: DSN,
      logs: [validLogEntry({ context: { blob: "x".repeat(3000) } })],
    });

  assert.equal(res.status, 400);
});

test("accepts a log entry with a context well within the size cap", async () => {
  const res = await request(app)
    .post("/api/events/logs")
    .send({
      dsn: DSN,
      logs: [validLogEntry({ context: { orderId: "ord_1", amount: 42 } })],
    });

  assert.equal(res.status, 202);
});

test("rejects a log entry with an invalid level", async () => {
  const res = await request(app)
    .post("/api/events/logs")
    .send({ dsn: DSN, logs: [validLogEntry({ level: "verbose" })] });

  assert.equal(res.status, 400);
});

test("rejects a log entry missing a required field", async () => {
  const res = await request(app)
    .post("/api/events/logs")
    .send({ dsn: DSN, logs: [{ level: "info", timestamp: new Date().toISOString() }] });

  assert.equal(res.status, 400);
});

test("rejects an unknown DSN before ever attempting to publish", async () => {
  const unknownDsn = `crashlens://not-cached@localhost:3000/${PROJECT_ID}`;

  const res = await request(app)
    .post("/api/events/logs")
    .send({ dsn: unknownDsn, logs: [validLogEntry()] });

  assert.equal(res.status, 401);
});

test("accepts a well-formed batch against an active DSN and returns a batchId", async () => {
  const res = await request(app)
    .post("/api/events/logs")
    .send({
      dsn: DSN,
      logs: [
        validLogEntry({ traceId: "trace-abc", context: { requestId: "req-1" } }),
        validLogEntry({ level: "error", message: "payment failed" }),
      ],
    });

  assert.equal(res.status, 202);
  assert.equal(res.body.success, true);
  assert.ok(res.body.batchId.startsWith("logs_"));
});
