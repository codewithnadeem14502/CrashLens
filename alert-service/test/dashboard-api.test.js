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

const ORGANIZATION_ID = "507f1f77bcf86cd799439011";

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

const validWidget = {
  title: "Open critical issues",
  chartType: "stat",
  query: { dataset: "issues", aggregate: "count", filters: { severity: "critical" }, timeWindowMinutes: 60 },
};

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

test("rejects a request with no token", async () => {
  const res = await request(app).get("/api/dashboards");
  assert.equal(res.status, 401);
});

test("view-only permission cannot create a dashboard", async () => {
  const res = await request(app)
    .post("/api/dashboards")
    .set("Authorization", `Bearer ${viewOnlyToken}`)
    .send({ name: "Blocked" });
  assert.equal(res.status, 403);
});

test("rejects a widget query with a dataset/aggregate mismatch", async () => {
  const res = await request(app)
    .post("/api/dashboards")
    .set("Authorization", `Bearer ${manageToken}`)
    .send({
      name: "Bad widget",
      widgets: [{ ...validWidget, query: { ...validWidget.query, aggregate: "p95_duration_ms" } }],
    });
  assert.equal(res.status, 400);
});

test("creates a dashboard with a widget, assigning a server-side widgetId", async () => {
  const res = await request(app)
    .post("/api/dashboards")
    .set("Authorization", `Bearer ${manageToken}`)
    .send({ name: "Overview", widgets: [validWidget] });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.dashboard.name, "Overview");
  assert.equal(res.body.data.dashboard.widgets.length, 1);
  assert.ok(res.body.data.dashboard.widgets[0].widgetId);
});

test("lists dashboards scoped to the caller's organization only", async () => {
  const otherOrgToken = buildToken(["alert:view", "alert:manage"], "507f1f77bcf86cd799439999");
  await request(app)
    .post("/api/dashboards")
    .set("Authorization", `Bearer ${otherOrgToken}`)
    .send({ name: "Other org dashboard" });

  const res = await request(app).get("/api/dashboards").set("Authorization", `Bearer ${viewOnlyToken}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.data.dashboards.every((d) => d.organizationId === ORGANIZATION_ID));
  assert.ok(res.body.data.dashboards.some((d) => d.name === "Overview"));
  assert.ok(!res.body.data.dashboards.some((d) => d.name === "Other org dashboard"));
});

test("updating a dashboard replaces the widgets array wholesale", async () => {
  const created = await request(app)
    .post("/api/dashboards")
    .set("Authorization", `Bearer ${manageToken}`)
    .send({ name: "To update", widgets: [validWidget] });

  const dashboardId = created.body.data.dashboard.id;

  const updated = await request(app)
    .patch(`/api/dashboards/${dashboardId}`)
    .set("Authorization", `Bearer ${manageToken}`)
    .send({ widgets: [] });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.dashboard.widgets.length, 0);
});

test("returns 404 for a dashboard belonging to a different organization", async () => {
  const otherOrgToken = buildToken(["alert:view", "alert:manage"], "507f1f77bcf86cd799439999");
  const created = await request(app)
    .post("/api/dashboards")
    .set("Authorization", `Bearer ${otherOrgToken}`)
    .send({ name: "Cross-org" });

  const res = await request(app)
    .get(`/api/dashboards/${created.body.data.dashboard.id}`)
    .set("Authorization", `Bearer ${manageToken}`);

  assert.equal(res.status, 404);
});

test("deletes a dashboard", async () => {
  const created = await request(app)
    .post("/api/dashboards")
    .set("Authorization", `Bearer ${manageToken}`)
    .send({ name: "To delete" });

  const dashboardId = created.body.data.dashboard.id;

  const deleted = await request(app)
    .delete(`/api/dashboards/${dashboardId}`)
    .set("Authorization", `Bearer ${manageToken}`);
  assert.equal(deleted.status, 200);

  const getAfterDelete = await request(app)
    .get(`/api/dashboards/${dashboardId}`)
    .set("Authorization", `Bearer ${manageToken}`);
  assert.equal(getAfterDelete.status, 404);
});
