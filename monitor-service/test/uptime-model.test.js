const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { UptimeMonitor, UptimeCheck } = require("../src/models/uptime-model");

const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/crashlens-monitor-service-test";

const baseUptimeMonitor = (overrides = {}) => ({
  projectId: "507f1f77bcf86cd799439011",
  organizationId: "507f1f77bcf86cd799439022",
  name: "API health",
  slug: "api-health",
  url: "https://example.com/health",
  createdBy: "507f1f77bcf86cd799439033",
  ...overrides,
});

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  // See monitor-model.test.js's before() for why this is needed before a
  // uniqueness test can be relied on.
  await UptimeMonitor.init();
  await UptimeCheck.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

test("accepts a well-formed uptime monitor with defaults applied", async () => {
  const doc = await UptimeMonitor.create(baseUptimeMonitor());
  assert.equal(doc.method, "GET");
  assert.equal(doc.intervalSeconds, 60);
  assert.equal(doc.timeoutMs, 10000);
  assert.equal(doc.expectedStatusMin, 200);
  assert.equal(doc.expectedStatusMax, 299);
  assert.equal(doc.consecutiveFailureThreshold, 3);
  assert.equal(doc.status, "active");
  assert.equal(doc.lastStatus, "unknown");
  assert.equal(doc.incidentOpen, false);
  // Defaults to "now" (immediately due) so a freshly created monitor gets
  // probed on the very first prober tick - see jobs/uptime-prober.js.
  assert.ok(doc.nextProbeAt instanceof Date);
  assert.ok(doc.nextProbeAt.getTime() <= Date.now());
});

test("has a compound (status, nextProbeAt) index matching the prober's query shape", () => {
  const indexes = UptimeMonitor.schema.indexes();
  const swept = indexes.some(([fields]) => fields.status === 1 && fields.nextProbeAt === 1);
  assert.ok(swept, "expected a {status, nextProbeAt} index");
});

test("rejects a missing url", async () => {
  const doc = new UptimeMonitor(baseUptimeMonitor({ url: undefined }));
  await assert.rejects(() => doc.validate());
});

test("enforces a unique (organizationId, projectId, slug)", async () => {
  await UptimeMonitor.create(baseUptimeMonitor({ slug: "unique-uptime-slug" }));
  await assert.rejects(() =>
    UptimeMonitor.create(baseUptimeMonitor({ slug: "unique-uptime-slug" })),
  );
});

test("UptimeCheck.expiresAt carries a TTL index", () => {
  const indexes = UptimeCheck.schema.indexes();
  const ttlIndex = indexes.find(
    ([fields]) => Object.keys(fields).length === 1 && fields.expiresAt === 1,
  );
  assert.ok(ttlIndex, "expected a single-field index on expiresAt");
  assert.equal(ttlIndex[1].expireAfterSeconds, 0);
});

test("UptimeCheck.status only allows up/down (not unknown)", async () => {
  const doc = new UptimeCheck({
    uptimeMonitorId: new mongoose.Types.ObjectId(),
    projectId: "507f1f77bcf86cd799439011",
    organizationId: "507f1f77bcf86cd799439022",
    status: "unknown",
    checkedAt: new Date(),
  });
  await assert.rejects(() => doc.validate());
});
