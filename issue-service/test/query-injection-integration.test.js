const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const mongoose = require("mongoose");

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-do-not-use-in-real-deployments";
process.env.ACCESS_TOKEN_ISSUER =
  process.env.ACCESS_TOKEN_ISSUER || "crash-lens-auth-service";

const app = require("../src/app");

// End-to-end proof (real Mongo, real HTTP request through supertest) of the
// Module 1 P0 fix: an operator-injection query string must be rejected with
// 400 before it ever reaches Mongoose, while a well-formed query still
// works normally against the real database.
const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/crashlens-issue-service-test";

const buildToken = () =>
  jwt.sign(
    {
      sub: "507f1f77bcf86cd799439099",
      organizationId: "507f1f77bcf86cd799439011",
      membershipId: "507f1f77bcf86cd799439022",
      role: "admin",
      permissions: ["*"],
    },
    process.env.JWT_SECRET,
    { issuer: process.env.ACCESS_TOKEN_ISSUER },
  );

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

// Hits /api/issues/... - the actual mount api-gateway proxies /v1/issues to
// in production (issue-service previously also mounted the same router
// unprefixed at "/", which these tests used to hit by mistake; that dead
// mount was removed in app.js as part of Module 1 review since nothing in
// production ever reached it).

test("rejects an operator-injection payload in errorName (400, never reaches Mongo)", async () => {
  const res = await request(app)
    .get("/api/issues?errorName[$ne]=x")
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 400);
});

test("rejects an operator-injection payload in release", async () => {
  const res = await request(app)
    .get("/api/issues?release[$gt]=")
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 400);
});

test("rejects an operator-injection payload in search", async () => {
  const res = await request(app)
    .get("/api/issues?search[$regex]=.*")
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 400);
});

test("accepts a well-formed query and returns a normal (empty) result set", async () => {
  const res = await request(app)
    .get("/api/issues?errorName=TypeError&release=1.0.0")
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data.issues, []);
});

test("rejects unauthenticated requests before validation even runs", async () => {
  const res = await request(app).get("/api/issues?errorName[$ne]=x");
  assert.equal(res.status, 401);
});
