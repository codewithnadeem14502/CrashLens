const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");
const { UptimeMonitor, UptimeCheck } = require("../src/models/uptime-model");
const { probeUrl, probeOneMonitor, runProbeTick } = require("../src/jobs/uptime-prober");
const { closeRabbitMQ, connectToRabbitMQ } = require("../src/utils/rabbitmq");
const { QueueConfig } = require("../src/utils/constants");

const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/crashlens-monitor-service-test";

const PROJECT_ID = "507f1f77bcf86cd799439011";
const ORGANIZATION_ID = "507f1f77bcf86cd799439022";

// Pull-based occurrence buffer, same pattern (and same reasoning) as
// cron-sweep.test.js's waitForNextOccurrence - see that file's comment.
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

// A tiny local HTTP server this test fully controls, so probe outcomes
// (success, failure status, slow/timeout) are deterministic instead of
// depending on a real external endpoint being reachable from CI/sandbox.
let server;
let serverUrl;
let responseMode = "ok";

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  await UptimeMonitor.init();
  await UptimeCheck.init();

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

  server = http.createServer((req, res) => {
    if (responseMode === "ok") {
      res.writeHead(200);
      res.end("ok");
    } else if (responseMode === "error") {
      res.writeHead(500);
      res.end("error");
    } else if (responseMode === "slow") {
      setTimeout(() => {
        res.writeHead(200);
        res.end("slow-ok");
      }, 1500);
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}/`;
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await closeRabbitMQ();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  responseMode = "ok";
});

const createUptimeMonitor = (overrides = {}) =>
  UptimeMonitor.create({
    projectId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    name: "Local probe target",
    slug: `probe-test-${Math.random().toString(36).slice(2)}`,
    url: serverUrl,
    timeoutMs: 1000,
    consecutiveFailureThreshold: 3,
    createdBy: "507f1f77bcf86cd799439033",
    ...overrides,
  });

test("probeUrl reports up for a matching status code", async () => {
  responseMode = "ok";
  const monitor = await createUptimeMonitor();
  const result = await probeUrl(monitor);

  assert.equal(result.status, "up");
  assert.equal(result.statusCode, 200);
  assert.equal(result.error, undefined);
});

test("probeUrl reports down for a non-matching status code", async () => {
  responseMode = "error";
  const monitor = await createUptimeMonitor();
  const result = await probeUrl(monitor);

  assert.equal(result.status, "down");
  assert.equal(result.statusCode, 500);
  assert.match(result.error, /Unexpected status code 500/);
});

test("probeUrl reports down with a timeout error when the target is too slow", async () => {
  responseMode = "slow";
  const monitor = await createUptimeMonitor({ timeoutMs: 1000 });
  const result = await probeUrl(monitor);

  assert.equal(result.status, "down");
  assert.match(result.error, /timed out/);
});

test("probeUrl reports down for an unreachable host", async () => {
  const monitor = await createUptimeMonitor({ url: "http://127.0.0.1:1/", timeoutMs: 1000 });
  const result = await probeUrl(monitor);

  assert.equal(result.status, "down");
  assert.ok(result.error);
});

test("probeOneMonitor resets consecutiveFailures and incidentOpen on a successful probe", async () => {
  responseMode = "ok";
  const monitor = await createUptimeMonitor({ consecutiveFailures: 5, incidentOpen: true });

  const result = await probeOneMonitor(monitor, new Date());

  assert.equal(result.recovered, true);
  assert.equal(monitor.consecutiveFailures, 0);
  assert.equal(monitor.incidentOpen, false);
  assert.equal(monitor.lastStatus, "up");

  const check = await UptimeCheck.findOne({ uptimeMonitorId: monitor._id });
  assert.equal(check.status, "up");
});

test("probeOneMonitor does not publish an occurrence before the failure threshold is reached", async () => {
  responseMode = "error";
  const monitor = await createUptimeMonitor({ consecutiveFailureThreshold: 3 });

  const result = await probeOneMonitor(monitor, new Date());

  assert.equal(result.notified, false);
  assert.equal(monitor.consecutiveFailures, 1);
  assert.equal(monitor.incidentOpen, false);
});

test("probeOneMonitor publishes exactly one occurrence the moment the threshold is crossed, not on every subsequent failure", async () => {
  responseMode = "error";
  const monitor = await createUptimeMonitor({ consecutiveFailureThreshold: 2 });

  // 1st failure: below threshold, no notification.
  await probeOneMonitor(monitor, new Date());
  assert.equal(monitor.incidentOpen, false);

  // 2nd failure: crosses the threshold - exactly one occurrence.
  const occurrencePromise = waitForNextOccurrence();
  const secondResult = await probeOneMonitor(monitor, new Date());
  const occurrence = await occurrencePromise;

  assert.equal(secondResult.notified, true);
  assert.equal(monitor.incidentOpen, true);
  assert.equal(occurrence.data.errorName, "UptimeDown");
  assert.equal(occurrence.data.severity, "critical");
  assert.equal(occurrence.data.fingerprint, `uptime:${monitor._id}`);

  // 3rd failure: still past threshold, but already notified for this run -
  // must NOT publish a second occurrence. Race the next message against a
  // short timer so "no message arrives" is provable instead of the test
  // just hanging if this regresses.
  const thirdResult = await probeOneMonitor(monitor, new Date());
  assert.equal(thirdResult.notified, false);

  // Proves "nothing arrived" by checking the buffer directly after a grace
  // period, rather than calling waitForNextOccurrence() and racing it - the
  // latter would register a resolver that, if this assertion ever holds
  // (nothing arrives), is *never consumed* and stays first in line in
  // pendingResolvers forever, silently stealing the next test's message out
  // from under it (a real bug this test suite hit - see the comment above
  // waitForNextOccurrence for the general pattern; this is the specific
  // trap of *partially* using it and abandoning the promise).
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(bufferedMessages.length, 0, "no extra occurrence should have been published");
});

test("probeOneMonitor re-notifies on a fresh incident after a recovery in between", async () => {
  responseMode = "error";
  const monitor = await createUptimeMonitor({ consecutiveFailureThreshold: 1 });

  const firstOccurrence = waitForNextOccurrence();
  await probeOneMonitor(monitor, new Date());
  await firstOccurrence;
  assert.equal(monitor.incidentOpen, true);

  responseMode = "ok";
  await probeOneMonitor(monitor, new Date());
  assert.equal(monitor.incidentOpen, false);

  responseMode = "error";
  const secondOccurrence = waitForNextOccurrence();
  const result = await probeOneMonitor(monitor, new Date());
  await secondOccurrence;

  assert.equal(result.notified, true);
  assert.equal(monitor.incidentOpen, true);
});

// Backend review finding (Module 8): findDueUptimeMonitors's query shape
// (against the precomputed nextProbeAt field, see models/uptime-model.js)
// had no test asserting it actually finds due monitors and skips not-due
// ones - runProbeTick is the real entry point that calls it, so exercising
// runProbeTick end-to-end proves the query itself works, not just
// probeOneMonitor in isolation.
test("runProbeTick only probes monitors whose nextProbeAt has passed", async () => {
  responseMode = "ok";

  const dueMonitor = await createUptimeMonitor({
    nextProbeAt: new Date(Date.now() - 1000),
  });
  const notDueMonitor = await createUptimeMonitor({
    nextProbeAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  await runProbeTick();

  const [refreshedDue, refreshedNotDue] = await Promise.all([
    UptimeMonitor.findById(dueMonitor._id),
    UptimeMonitor.findById(notDueMonitor._id),
  ]);

  assert.equal(refreshedDue.lastStatus, "up", "the due monitor should have been probed");
  assert.equal(
    refreshedNotDue.lastStatus,
    "unknown",
    "the not-due monitor should be untouched",
  );

  const dueCheckCount = await UptimeCheck.countDocuments({ uptimeMonitorId: dueMonitor._id });
  const notDueCheckCount = await UptimeCheck.countDocuments({
    uptimeMonitorId: notDueMonitor._id,
  });
  assert.equal(dueCheckCount, 1);
  assert.equal(notDueCheckCount, 0);
});
