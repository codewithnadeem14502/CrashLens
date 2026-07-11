const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { Monitor, CheckIn, generateCheckToken } = require("../src/models/monitor-model");
const { sweepMissedCheckIns, sweepTimedOutCheckIns } = require("../src/jobs/cron-sweep");
const { closeRabbitMQ, connectToRabbitMQ } = require("../src/utils/rabbitmq");
const { QueueConfig } = require("../src/utils/constants");

const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/crashlens-monitor-service-test";

const PROJECT_ID = "507f1f77bcf86cd799439011";
const ORGANIZATION_ID = "507f1f77bcf86cd799439022";

const createMonitor = (overrides = {}) =>
  Monitor.create({
    projectId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    name: "Nightly backup",
    slug: `sweep-test-${Math.random().toString(36).slice(2)}`,
    scheduleType: "interval",
    intervalSeconds: 3600,
    checkinMarginSeconds: 60,
    maxRuntimeSeconds: 300,
    status: "active",
    checkToken: generateCheckToken(),
    createdBy: "507f1f77bcf86cd799439033",
    ...overrides,
  });

// A single long-lived exclusive queue, bound once in before() and drained
// through this pull-based buffer, rather than a fresh assert/bind/consume
// setup awaited from inside each test. Consuming from a per-test extracted
// async helper (assert -> bind -> consume, invoked and awaited from within
// a node:test test() body) was empirically found to hang indefinitely -
// the helper's own body ran to completion (every internal await resolved,
// confirmed via step-by-step logging) but control never returned to the
// awaiting caller. A standalone script with identical logic (no node:test)
// worked every time, so this is a test-runner-specific interaction, not a
// product bug in the publish/consume path itself. Doing the one-time async
// setup in before() (which was never the part that hung) and exposing a
// plain *synchronous* function to each test sidesteps the pattern entirely.
let pendingResolvers = [];
let bufferedMessages = [];

const waitForNextOccurrence = () => {
  if (bufferedMessages.length) {
    return Promise.resolve(bufferedMessages.shift());
  }

  return new Promise((resolve) => {
    pendingResolvers.push(resolve);
  });
};

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  await Monitor.init();
  await CheckIn.init();

  const channel = await connectToRabbitMQ();
  const { queue } = await channel.assertQueue("", { exclusive: true });
  await channel.bindQueue(queue, QueueConfig.EXCHANGE_NAME, "issue.occurrence.detected");
  await channel.consume(
    queue,
    (msg) => {
      if (!msg) {
        return;
      }

      channel.ack(msg);
      const parsed = JSON.parse(msg.content.toString());

      if (pendingResolvers.length) {
        pendingResolvers.shift()(parsed);
      } else {
        bufferedMessages.push(parsed);
      }
    },
    { noAck: false },
  );
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await closeRabbitMQ();
});

test("sweepMissedCheckIns ignores a monitor that isn't due yet", async () => {
  const monitor = await createMonitor({
    nextExpectedAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const processed = await sweepMissedCheckIns(new Date());

  assert.equal(processed, 0);
  const refreshed = await Monitor.findById(monitor._id);
  assert.equal(refreshed.lastCheckInStatus, undefined);
});

test("sweepMissedCheckIns records a missed check-in, advances nextExpectedAt, and publishes an occurrence", async () => {
  const now = new Date();
  const overdueWindow = new Date(now.getTime() - 10 * 60 * 1000); // 10 min ago
  const monitor = await createMonitor({ nextExpectedAt: overdueWindow });

  const occurrencePromise = waitForNextOccurrence();
  const processed = await sweepMissedCheckIns(now);
  const occurrence = await occurrencePromise;

  assert.equal(processed, 1);

  const checkIn = await CheckIn.findOne({ monitorId: monitor._id });
  assert.equal(checkIn.status, "missed");
  assert.equal(checkIn.startedAt.getTime(), overdueWindow.getTime());

  const refreshed = await Monitor.findById(monitor._id);
  assert.equal(refreshed.lastCheckInStatus, "missed");
  // Advanced from *now*, not from the missed window - must be strictly
  // after the original overdue window plus the interval.
  assert.ok(refreshed.nextExpectedAt.getTime() > now.getTime());

  // Contract check (no cross-repo import): matches what issue-service's
  // validateOccurrenceEnvelope (issue-events.js) actually requires -
  // sourceEventId/projectId/organizationId/fingerprint/message/severity
  // all present, severity a valid enum value.
  assert.equal(occurrence.eventType, "issue.occurrence.detected");
  assert.equal(occurrence.data.projectId, PROJECT_ID);
  assert.equal(occurrence.data.organizationId, ORGANIZATION_ID);
  assert.equal(occurrence.data.fingerprint, `monitor:${monitor._id}`);
  assert.equal(occurrence.data.errorName, "MonitorMissed");
  assert.equal(occurrence.data.severity, "medium");
  assert.ok(occurrence.data.sourceEventId);
  assert.ok(occurrence.data.message);
});

test("sweepMissedCheckIns does not double-process the same monitor on a second immediate tick", async () => {
  const now = new Date();
  const overdueWindow = new Date(now.getTime() - 10 * 60 * 1000);
  await createMonitor({ nextExpectedAt: overdueWindow });

  const occurrencePromise = waitForNextOccurrence();
  const firstPass = await sweepMissedCheckIns(now);
  await occurrencePromise;
  const secondPass = await sweepMissedCheckIns(now);

  assert.equal(firstPass, 1);
  assert.equal(secondPass, 0);
});

test("sweepTimedOutCheckIns ignores an in_progress check-in that hasn't hit its deadline yet", async () => {
  const monitor = await createMonitor();
  await CheckIn.create({
    monitorId: monitor._id,
    projectId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    status: "in_progress",
    startedAt: new Date(),
    timeoutAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const processed = await sweepTimedOutCheckIns(new Date());
  assert.equal(processed, 0);
});

test("sweepTimedOutCheckIns marks an overdue in_progress check-in as timeout, advances the monitor, and publishes an occurrence", async () => {
  const now = new Date();
  const monitor = await createMonitor();
  const startedAt = new Date(now.getTime() - 20 * 60 * 1000);
  const checkIn = await CheckIn.create({
    monitorId: monitor._id,
    projectId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    status: "in_progress",
    startedAt,
    timeoutAt: new Date(now.getTime() - 60 * 1000), // 1 min overdue
  });

  const occurrencePromise = waitForNextOccurrence();
  const processed = await sweepTimedOutCheckIns(now);
  const occurrence = await occurrencePromise;

  assert.equal(processed, 1);

  const refreshedCheckIn = await CheckIn.findById(checkIn._id);
  assert.equal(refreshedCheckIn.status, "timeout");
  assert.ok(refreshedCheckIn.finishedAt);
  assert.ok(refreshedCheckIn.durationMs > 0);

  const refreshedMonitor = await Monitor.findById(monitor._id);
  assert.equal(refreshedMonitor.lastCheckInStatus, "timeout");

  assert.equal(occurrence.data.errorName, "MonitorTimeout");
  assert.equal(occurrence.data.severity, "high");
  assert.equal(occurrence.data.fingerprint, `monitor:${monitor._id}`);
});

test("sweepTimedOutCheckIns tolerates a check-in whose parent monitor was deleted", async () => {
  const now = new Date();
  const orphanMonitorId = new mongoose.Types.ObjectId();
  const checkIn = await CheckIn.create({
    monitorId: orphanMonitorId,
    projectId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    status: "in_progress",
    startedAt: new Date(now.getTime() - 20 * 60 * 1000),
    timeoutAt: new Date(now.getTime() - 60 * 1000),
  });

  await assert.doesNotReject(() => sweepTimedOutCheckIns(now));

  const refreshed = await CheckIn.findById(checkIn._id);
  assert.equal(refreshed.status, "timeout");
});
