const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const mongoose = require("mongoose");
const { Monitor, CheckIn, generateCheckToken } = require("../src/models/monitor-model");

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-do-not-use-in-real-deployments";
process.env.ACCESS_TOKEN_ISSUER =
  process.env.ACCESS_TOKEN_ISSUER || "crash-lens-auth-service";

const app = require("../src/app");

const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/crashlens-monitor-service-test";

const PROJECT_ID = "507f1f77bcf86cd799439011";
const ORGANIZATION_ID = "507f1f77bcf86cd799439055";
const CHECK_TOKEN = generateCheckToken();

let monitorId;

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

  const monitor = await Monitor.create({
    projectId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    name: "API checkin monitor",
    slug: "api-checkin-monitor",
    scheduleType: "interval",
    intervalSeconds: 3600,
    checkToken: CHECK_TOKEN,
    createdBy: "507f1f77bcf86cd799439033",
  });
  monitorId = monitor._id.toString();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

test("rejects a check-in with a missing token", async () => {
  const res = await request(app)
    .post(`/api/monitors/${monitorId}/checkins`)
    .send({ status: "ok" });

  assert.equal(res.status, 400);
});

test("rejects a check-in with the wrong token", async () => {
  const res = await request(app)
    .post(`/api/monitors/${monitorId}/checkins`)
    .send({ token: "not-the-real-token", status: "ok" });

  assert.equal(res.status, 401);
});

test("rejects a check-in for a non-existent monitor with the same 401 (doesn't leak existence)", async () => {
  const fakeId = new mongoose.Types.ObjectId().toString();
  const res = await request(app)
    .post(`/api/monitors/${fakeId}/checkins`)
    .send({ token: CHECK_TOKEN, status: "ok" });

  assert.equal(res.status, 401);
});

test("single-ping ok check-in is accepted with the correct token and advances the monitor", async () => {
  const res = await request(app)
    .post(`/api/monitors/${monitorId}/checkins`)
    .send({ token: CHECK_TOKEN, status: "ok" });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.checkIn.status, "ok");

  const monitor = await Monitor.findById(monitorId);
  assert.equal(monitor.lastCheckInStatus, "ok");
  assert.ok(monitor.nextExpectedAt.getTime() > Date.now());
});

test("two-step start/finish check-in flow works end to end", async () => {
  const startRes = await request(app)
    .post(`/api/monitors/${monitorId}/checkins`)
    .send({ token: CHECK_TOKEN }); // status omitted -> in_progress

  assert.equal(startRes.status, 201);
  assert.equal(startRes.body.data.checkIn.status, "in_progress");
  const checkinId = startRes.body.data.checkIn.id;

  const finishRes = await request(app)
    .patch(`/api/monitors/${monitorId}/checkins/${checkinId}`)
    .send({ token: CHECK_TOKEN, status: "ok" });

  assert.equal(finishRes.status, 200);
  assert.equal(finishRes.body.data.checkIn.status, "ok");
  assert.ok(finishRes.body.data.checkIn.durationMs >= 0);
});

test("finishing an already-finished check-in fails (no in_progress row to match)", async () => {
  const startRes = await request(app)
    .post(`/api/monitors/${monitorId}/checkins`)
    .send({ token: CHECK_TOKEN });
  const checkinId = startRes.body.data.checkIn.id;

  await request(app)
    .patch(`/api/monitors/${monitorId}/checkins/${checkinId}`)
    .send({ token: CHECK_TOKEN, status: "ok" });

  const secondFinish = await request(app)
    .patch(`/api/monitors/${monitorId}/checkins/${checkinId}`)
    .send({ token: CHECK_TOKEN, status: "error" });

  assert.equal(secondFinish.status, 404);
});

test("check-in history (GET) requires a JWT, unlike the ping routes", async () => {
  const res = await request(app).get(`/api/monitors/${monitorId}/checkins`);
  assert.equal(res.status, 401);
});

test("check-in history (GET) returns real data once authenticated", async () => {
  const res = await request(app)
    .get(`/api/monitors/${monitorId}/checkins`)
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.data.checkIns.length >= 1);
});

test("rejects an operator-injection payload on the monitors list query", async () => {
  const res = await request(app)
    .get("/api/monitors?status[$ne]=active")
    .set("Authorization", `Bearer ${buildToken()}`);

  assert.equal(res.status, 400);
});

test("list monitors is scoped to the caller's organization", async () => {
  const res = await request(app)
    .get("/api/monitors")
    .set("Authorization", `Bearer ${buildToken("507f1f77bcf86cd799439066")}`); // different org

  assert.equal(res.status, 200);
  assert.equal(res.body.data.monitors.length, 0);
});

test("GET /health does not require auth or touch the DB", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.service, "monitor-service");
});
