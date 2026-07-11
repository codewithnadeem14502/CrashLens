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

const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/crashlens-alert-service-test";

const ORGANIZATION_ID = "507f1f77bcf86cd799439012";

const buildToken = (permissions, organizationId = ORGANIZATION_ID) =>
  jwt.sign(
    {
      sub: "507f1f77bcf86cd799439099",
      organizationId,
      membershipId: "507f1f77bcf86cd799439022",
      role: "admin",
      permissions,
    },
    process.env.JWT_SECRET,
    { issuer: process.env.ACCESS_TOKEN_ISSUER },
  );

const manageToken = buildToken(["alert:view", "alert:manage"]);
const viewOnlyToken = buildToken(["alert:view"]);

const validRule = {
  name: "High error rate",
  query: {
    dataset: "transactions",
    aggregate: "error_rate",
    filters: {},
    timeWindowMinutes: 15,
  },
  thresholdType: "static",
  direction: "above",
  warningThreshold: 5,
  criticalThreshold: 15,
  resolveThreshold: 2,
};

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

test("rejects a rule with no resolve-threshold hysteresis (resolveThreshold not below warningThreshold)", async () => {
  const res = await request(app)
    .post("/api/alerts/rules")
    .set("Authorization", `Bearer ${manageToken}`)
    .send({ ...validRule, resolveThreshold: 10 });
  assert.equal(res.status, 400);
});

test("view-only permission cannot create a rule", async () => {
  const res = await request(app)
    .post("/api/alerts/rules")
    .set("Authorization", `Bearer ${viewOnlyToken}`)
    .send(validRule);
  assert.equal(res.status, 403);
});

test("creates a rule, defaulting status to active and state to ok", async () => {
  const res = await request(app)
    .post("/api/alerts/rules")
    .set("Authorization", `Bearer ${manageToken}`)
    .send(validRule);

  assert.equal(res.status, 201);
  assert.equal(res.body.data.rule.status, "active");
  assert.equal(res.body.data.rule.state, "ok");
  assert.equal(res.body.data.rule.evaluationIntervalSeconds, 60);
});

test("view-only permission can list and read rules", async () => {
  const created = await request(app)
    .post("/api/alerts/rules")
    .set("Authorization", `Bearer ${manageToken}`)
    .send({ ...validRule, name: "Readable by viewer" });

  const list = await request(app).get("/api/alerts/rules").set("Authorization", `Bearer ${viewOnlyToken}`);
  assert.equal(list.status, 200);

  const get = await request(app)
    .get(`/api/alerts/rules/${created.body.data.rule.id}`)
    .set("Authorization", `Bearer ${viewOnlyToken}`);
  assert.equal(get.status, 200);
});

test("a status-only pause update does not require resending thresholds", async () => {
  const created = await request(app)
    .post("/api/alerts/rules")
    .set("Authorization", `Bearer ${manageToken}`)
    .send({ ...validRule, name: "Pausable" });

  const res = await request(app)
    .patch(`/api/alerts/rules/${created.body.data.rule.id}`)
    .set("Authorization", `Bearer ${manageToken}`)
    .send({ status: "paused" });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.rule.status, "paused");
});

test("deleting a rule also deletes its alert event history", async () => {
  const { AlertRule } = require("../src/models/alert-rule-model");
  const { AlertEvent } = require("../src/models/alert-event-model");

  const rule = await AlertRule.create({
    organizationId: ORGANIZATION_ID,
    name: "With history",
    query: validRule.query,
    thresholdType: "static",
    direction: "above",
    warningThreshold: 5,
    resolveThreshold: 2,
    createdBy: "507f1f77bcf86cd799439033",
  });
  await AlertEvent.create({
    ruleId: rule._id,
    organizationId: ORGANIZATION_ID,
    ruleName: rule.name,
    fromState: "ok",
    toState: "warning",
    value: 10,
  });

  const res = await request(app)
    .delete(`/api/alerts/rules/${rule._id}`)
    .set("Authorization", `Bearer ${manageToken}`);
  assert.equal(res.status, 200);

  assert.equal(await AlertEvent.countDocuments({ ruleId: rule._id }), 0);
});

test("lists alert event history for a rule, most recent first", async () => {
  const { AlertRule } = require("../src/models/alert-rule-model");
  const { AlertEvent } = require("../src/models/alert-event-model");

  const rule = await AlertRule.create({
    organizationId: ORGANIZATION_ID,
    name: "History order",
    query: validRule.query,
    thresholdType: "static",
    direction: "above",
    warningThreshold: 5,
    resolveThreshold: 2,
    createdBy: "507f1f77bcf86cd799439033",
  });

  await AlertEvent.create({
    ruleId: rule._id,
    organizationId: ORGANIZATION_ID,
    ruleName: rule.name,
    fromState: "ok",
    toState: "warning",
    value: 10,
    triggeredAt: new Date(Date.now() - 60000),
  });
  await AlertEvent.create({
    ruleId: rule._id,
    organizationId: ORGANIZATION_ID,
    ruleName: rule.name,
    fromState: "warning",
    toState: "ok",
    value: 1,
    triggeredAt: new Date(),
  });

  const res = await request(app)
    .get(`/api/alerts/rules/${rule._id}/events`)
    .set("Authorization", `Bearer ${viewOnlyToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.events.length, 2);
  assert.equal(res.body.data.events[0].toState, "ok");
  assert.equal(res.body.data.events[1].toState, "warning");
});
