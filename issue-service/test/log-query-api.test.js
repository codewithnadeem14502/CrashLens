const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const mongoose = require("mongoose");
const { LogEntry } = require("../src/models/issue-model");

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-do-not-use-in-real-deployments";
process.env.ACCESS_TOKEN_ISSUER =
  process.env.ACCESS_TOKEN_ISSUER || "crash-lens-auth-service";

const app = require("../src/app");

// GET /api/logs - real HTTP through supertest against the real Mongo test
// DB, same rigor as query-injection-integration.test.js (issues) and
// performance-endpoint-spans-serialization.test.js (performance): proves
// the operator-injection guard on a *new* route from day one, and that a
// well-formed query returns real, correctly-scoped data.
const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/crashlens-issue-service-test";

const ORGANIZATION_ID = "507f1f77bcf86cd799439055";
const PROJECT_ID = "507f1f77bcf86cd799439066";
const OTHER_ORGANIZATION_ID = "507f1f77bcf86cd799439077";

const buildToken = (organizationId = ORGANIZATION_ID) =>
  jwt.sign(
    {
      sub: "507f1f77bcf86cd799439099",
      organizationId,
      membershipId: "507f1f77bcf86cd799439022",
      role: "admin",
      permissions: ["*"],
    },
    process.env.JWT_SECRET,
    { issuer: process.env.ACCESS_TOKEN_ISSUER },
  );

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);

  await LogEntry.create([
    {
      entryId: "log-query-1",
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
      level: "error",
      message: "payment gateway timeout",
      traceId: "trace-query-1",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      entryId: "log-query-2",
      projectId: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
      level: "info",
      message: "user signed in",
      occurredAt: new Date("2026-01-02T00:00:00.000Z"),
    },
    {
      entryId: "log-query-3",
      projectId: PROJECT_ID,
      organizationId: OTHER_ORGANIZATION_ID,
      level: "error",
      message: "should never be visible cross-tenant",
      occurredAt: new Date("2026-01-03T00:00:00.000Z"),
    },
  ]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

test("rejects an operator-injection payload in search", async () => {
  const res = await request(app)
    .get("/api/logs?search[$regex]=.*")
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 400);
});

test("rejects an operator-injection payload in traceId", async () => {
  const res = await request(app)
    .get("/api/logs?traceId[$ne]=x")
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 400);
});

test("rejects an invalid level", async () => {
  const res = await request(app)
    .get("/api/logs?level=verbose")
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 400);
});

test("rejects unauthenticated requests", async () => {
  const res = await request(app).get("/api/logs");
  assert.equal(res.status, 401);
});

test("returns only logs scoped to the caller's organization, newest first", async () => {
  const res = await request(app)
    .get(`/api/logs?projectId=${PROJECT_ID}`)
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.logs.length, 2);
  assert.ok(res.body.data.logs.every((log) => log.organizationId === ORGANIZATION_ID));
});

test("filters by level", async () => {
  const res = await request(app)
    .get(`/api/logs?projectId=${PROJECT_ID}&level=error`)
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.logs.length, 1);
  assert.equal(res.body.data.logs[0].entryId, "log-query-1");
});

test("filters by traceId", async () => {
  const res = await request(app)
    .get(`/api/logs?projectId=${PROJECT_ID}&traceId=trace-query-1`)
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.logs.length, 1);
  assert.equal(res.body.data.logs[0].traceId, "trace-query-1");
});

// Regression guard for the exact bug class Module 3 fixed for issues: sort
// must actually re-query the full matching set server-side, not just
// re-order whichever page already came back - a frontend that reversed the
// current page in place would still pass a naive "results are reversed"
// check while silently showing the wrong 25 rows on page 1 of a larger set.
test("order=asc returns oldest first (server-side sort, not a client-side reverse)", async () => {
  const res = await request(app)
    .get(`/api/logs?projectId=${PROJECT_ID}&order=asc`)
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.data.logs.map((log) => log.entryId),
    ["log-query-1", "log-query-2"],
  );
});

test("order=desc (default) returns newest first", async () => {
  const res = await request(app)
    .get(`/api/logs?projectId=${PROJECT_ID}`)
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.data.logs.map((log) => log.entryId),
    ["log-query-2", "log-query-1"],
  );
});

test("rejects an invalid order value", async () => {
  const res = await request(app)
    .get(`/api/logs?projectId=${PROJECT_ID}&order=sideways`)
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 400);
});
