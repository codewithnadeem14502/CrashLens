const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const mongoose = require("mongoose");
const { PerformanceTransaction } = require("../src/models/issue-model");

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-do-not-use-in-real-deployments";
process.env.ACCESS_TOKEN_ISSUER =
  process.env.ACCESS_TOKEN_ISSUER || "crash-lens-auth-service";

const app = require("../src/app");

// Read-path half of the Module 6 P1 fix: spans (which can carry arbitrary
// per-span `data`) must not flow into list-view responses - only into the
// single-trace detail view where the caller actually asked to see them.
const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/crashlens-issue-service-test";

const ORGANIZATION_ID = "507f1f77bcf86cd799439011";
const PROJECT_ID = "507f1f77bcf86cd799439033";

const buildToken = () =>
  jwt.sign(
    {
      sub: "507f1f77bcf86cd799439099",
      organizationId: ORGANIZATION_ID,
      membershipId: "507f1f77bcf86cd799439022",
      role: "admin",
      permissions: ["*"],
    },
    process.env.JWT_SECRET,
    { issuer: process.env.ACCESS_TOKEN_ISSUER },
  );

const getEndpointKey = (method, route) =>
  Buffer.from(`${method} ${route}`, "utf8").toString("base64url");

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);

  await PerformanceTransaction.create({
    transactionId: "txn-serialization-test",
    projectId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    method: "GET",
    route: "/checkout/:id",
    durationMs: 123,
    statusCode: 200,
    traceId: "trace-serialization-test",
    occurredAt: new Date(),
    spans: [{ spanId: "span-1", op: "db.query", data: { query: "SELECT 1" } }],
  });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

test("getEndpointPerformance (list view) omits spans from both slowest and recent transactions", async () => {
  const endpointId = getEndpointKey("GET", "/checkout/:id");

  const res = await request(app)
    .get(`/api/issues/performance/endpoints/${endpointId}?projectId=${PROJECT_ID}&dateFrom=2000-01-01`)
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.data.slowestTransactions.length >= 1);
  assert.ok(res.body.data.recentTransactions.length >= 1);

  for (const transaction of [
    ...res.body.data.slowestTransactions,
    ...res.body.data.recentTransactions,
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(transaction, "spans"),
      false,
      "list-view transactions must not include a spans key at all",
    );
  }
});

test("getTrace (single-trace detail view) still includes full spans", async () => {
  const res = await request(app)
    .get(`/api/issues/performance/traces/trace-serialization-test?projectId=${PROJECT_ID}&dateFrom=2000-01-01`)
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.transactions.length, 1);
  assert.equal(res.body.data.transactions[0].spans.length, 1);
  assert.equal(res.body.data.transactions[0].spans[0].op, "db.query");
});
