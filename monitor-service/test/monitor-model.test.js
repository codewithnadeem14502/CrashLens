const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { Monitor, CheckIn, generateCheckToken } = require("../src/models/monitor-model");

const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/crashlens-monitor-service-test";

const baseMonitor = (overrides = {}) => ({
  projectId: "507f1f77bcf86cd799439011",
  organizationId: "507f1f77bcf86cd799439022",
  name: "Nightly backup",
  slug: "nightly-backup",
  scheduleType: "interval",
  intervalSeconds: 3600,
  checkToken: generateCheckToken(),
  createdBy: "507f1f77bcf86cd799439033",
  ...overrides,
});

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  // Model.init() waits for the driver to finish building declared indexes
  // (including the unique ones) - mongoose.connect() alone doesn't await
  // this, so a uniqueness test that runs immediately after connecting can
  // race the index build and silently see no constraint yet.
  await Monitor.init();
  await CheckIn.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

test("rejects an invalid scheduleType", async () => {
  const doc = new Monitor(baseMonitor({ scheduleType: "weekly" }));
  await assert.rejects(() => doc.validate());
});

test("accepts a well-formed interval monitor", async () => {
  const doc = new Monitor(baseMonitor());
  await assert.doesNotReject(() => doc.validate());
});

test("checkToken is select:false by default", async () => {
  const created = await Monitor.create(baseMonitor({ slug: "select-false-test" }));
  const found = await Monitor.findById(created._id);
  assert.equal(found.checkToken, undefined);

  const foundWithToken = await Monitor.findById(created._id).select("+checkToken");
  assert.equal(typeof foundWithToken.checkToken, "string");
});

test("enforces a unique (organizationId, projectId, slug)", async () => {
  await Monitor.create(baseMonitor({ slug: "unique-slug-test" }));
  await assert.rejects(() => Monitor.create(baseMonitor({ slug: "unique-slug-test" })));
});

test("has a compound (status, nextExpectedAt) index matching the sweep's query shape", () => {
  const indexes = Monitor.schema.indexes();
  const swept = indexes.some(
    ([fields]) => fields.status === 1 && fields.nextExpectedAt === 1,
  );
  assert.ok(swept, "expected a {status, nextExpectedAt} index");
});

test("CheckIn.expiresAt carries a TTL index", () => {
  const indexes = CheckIn.schema.indexes();
  const ttlIndex = indexes.find(
    ([fields]) => Object.keys(fields).length === 1 && fields.expiresAt === 1,
  );
  assert.ok(ttlIndex, "expected a single-field index on expiresAt");
  assert.equal(ttlIndex[1].expireAfterSeconds, 0);
});

test("CheckIn has a (status, timeoutAt) index matching the timeout sweep's query shape", () => {
  const indexes = CheckIn.schema.indexes();
  const timeoutIndex = indexes.some(
    ([fields]) => fields.status === 1 && fields.timeoutAt === 1,
  );
  assert.ok(timeoutIndex, "expected a {status, timeoutAt} index");
});

test("generateCheckToken produces distinct, non-trivial tokens", () => {
  const a = generateCheckToken();
  const b = generateCheckToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
});
