const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { AlertRule } = require("../src/models/alert-rule-model");
const { AlertEvent } = require("../src/models/alert-event-model");
const queryExecutor = require("../src/query/query-executor");
const emailAction = require("../src/notifications/email-action");
const webhookAction = require("../src/notifications/webhook-action");
const { evaluateRule, runSweep } = require("../src/jobs/alert-evaluator");
const { AlertState, ThresholdDirection, ThresholdType, RuleStatus, Dataset, Aggregate } = require("../src/utils/constants");

const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/crashlens-alert-service-test";

const ORGANIZATION_ID = "507f1f77bcf86cd799439011";

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  await AlertRule.init();
  await AlertEvent.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

beforeEach(() => {
  mock.restoreAll();
});

const createRule = (overrides = {}) =>
  AlertRule.create({
    organizationId: ORGANIZATION_ID,
    name: "Test rule",
    status: RuleStatus.ACTIVE,
    query: { dataset: Dataset.ISSUES, aggregate: Aggregate.COUNT, filters: {}, timeWindowMinutes: 60 },
    thresholdType: ThresholdType.STATIC,
    direction: ThresholdDirection.ABOVE,
    warningThreshold: 10,
    criticalThreshold: 20,
    resolveThreshold: 5,
    evaluationIntervalSeconds: 60,
    notificationActions: [],
    createdBy: "507f1f77bcf86cd799439033",
    ...overrides,
  });

test("evaluateRule fires an AlertEvent and moves state ok -> warning on first threshold crossing", async () => {
  mock.method(queryExecutor, "executeQuery", async () => ({ value: 12, sampleSize: 12 }));

  const rule = await createRule();
  const now = new Date();
  const outcome = await evaluateRule(rule, now);

  assert.equal(outcome.previousState, AlertState.OK);
  assert.equal(outcome.nextState, AlertState.WARNING);

  const reloaded = await AlertRule.findById(rule._id);
  assert.equal(reloaded.state, AlertState.WARNING);
  assert.equal(reloaded.lastValue, 12);
  assert.ok(reloaded.lastTriggeredAt);

  const events = await AlertEvent.find({ ruleId: rule._id });
  assert.equal(events.length, 1);
  assert.equal(events[0].fromState, AlertState.OK);
  assert.equal(events[0].toState, AlertState.WARNING);
  assert.equal(events[0].thresholdCrossed, 10);
});

test("evaluateRule is idempotent: repeated evaluations at the same crossed value do not create duplicate events", async () => {
  mock.method(queryExecutor, "executeQuery", async () => ({ value: 25, sampleSize: 25 }));

  const rule = await createRule();
  const now = new Date();

  await evaluateRule(rule, now);
  const secondOutcome = await evaluateRule(rule, new Date(now.getTime() + 1000));
  const thirdOutcome = await evaluateRule(rule, new Date(now.getTime() + 2000));

  assert.equal(secondOutcome, null, "no state change -> no event, evaluateRule returns null");
  assert.equal(thirdOutcome, null);

  const events = await AlertEvent.find({ ruleId: rule._id });
  assert.equal(events.length, 1, "only the initial ok->critical transition should have created an event");

  const reloaded = await AlertRule.findById(rule._id);
  assert.equal(reloaded.state, AlertState.CRITICAL);
  // lastEvaluatedAt should still advance on every tick even when idempotent.
  assert.ok(reloaded.lastEvaluatedAt.getTime() >= now.getTime() + 2000);
});

test("evaluateRule resolves via hysteresis: dipping under warningThreshold but above resolveThreshold does not resolve, crossing resolveThreshold does", async () => {
  const rule = await createRule();
  const now = new Date();

  mock.method(queryExecutor, "executeQuery", async () => ({ value: 15 }));
  await evaluateRule(rule, now);
  assert.equal((await AlertRule.findById(rule._id)).state, AlertState.WARNING);

  mock.method(queryExecutor, "executeQuery", async () => ({ value: 7 })); // below warning(10), above resolve(5)
  const staysWarning = await evaluateRule(rule, new Date(now.getTime() + 1000));
  assert.equal(staysWarning, null, "still inside the hysteresis band - no transition, no event");
  assert.equal((await AlertRule.findById(rule._id)).state, AlertState.WARNING);

  mock.method(queryExecutor, "executeQuery", async () => ({ value: 3 })); // below resolveThreshold(5)
  const resolves = await evaluateRule(rule, new Date(now.getTime() + 2000));
  assert.equal(resolves.nextState, AlertState.OK);

  const events = await AlertEvent.find({ ruleId: rule._id }).sort({ triggeredAt: 1 });
  assert.equal(events.length, 2);
  assert.equal(events[1].toState, AlertState.OK);
  assert.equal(events[1].thresholdCrossed, rule.resolveThreshold);
});

test("evaluateRule dispatches configured notification actions on a firing transition and records delivery status per action", async () => {
  mock.method(queryExecutor, "executeQuery", async () => ({ value: 25 }));
  mock.method(emailAction, "sendEmail", async () => {});
  mock.method(webhookAction, "sendWebhook", async () => {
    throw new Error("upstream webhook receiver returned 500");
  });

  const rule = await createRule({
    notificationActions: [
      { type: "email", target: "oncall@example.com" },
      { type: "webhook", target: "https://hooks.example.com/incoming" },
    ],
  });

  await evaluateRule(rule, new Date());

  const events = await AlertEvent.find({ ruleId: rule._id });
  assert.equal(events.length, 1);
  assert.equal(events[0].notifications.length, 2);

  const emailResult = events[0].notifications.find((n) => n.type === "email");
  const webhookResult = events[0].notifications.find((n) => n.type === "webhook");

  assert.equal(emailResult.status, "sent");
  assert.equal(webhookResult.status, "failed");
  assert.match(webhookResult.error, /500/);
});

test("evaluateRule does not touch state or create an event when the upstream query fails, but still advances nextEvaluationAt", async () => {
  mock.method(queryExecutor, "executeQuery", async () => {
    throw new Error("upstream service unreachable");
  });

  const rule = await createRule();
  const before = rule.nextEvaluationAt.getTime();
  const now = new Date();

  const outcome = await evaluateRule(rule, now);
  assert.equal(outcome, null);

  const reloaded = await AlertRule.findById(rule._id);
  assert.equal(reloaded.state, AlertState.OK);
  assert.ok(reloaded.nextEvaluationAt.getTime() > before);
  assert.equal(await AlertEvent.countDocuments({ ruleId: rule._id }), 0);
});

test("runSweep only evaluates rules whose nextEvaluationAt has passed, and skips paused rules", async () => {
  mock.method(queryExecutor, "executeQuery", async () => ({ value: 25 }));

  const dueRule = await createRule({ nextEvaluationAt: new Date(Date.now() - 1000) });
  const notDueRule = await createRule({ nextEvaluationAt: new Date(Date.now() + 60 * 60 * 1000) });
  const pausedRule = await createRule({
    status: RuleStatus.PAUSED,
    nextEvaluationAt: new Date(Date.now() - 1000),
  });

  await runSweep(new Date());

  const [refreshedDue, refreshedNotDue, refreshedPaused] = await Promise.all([
    AlertRule.findById(dueRule._id),
    AlertRule.findById(notDueRule._id),
    AlertRule.findById(pausedRule._id),
  ]);

  assert.equal(refreshedDue.state, AlertState.CRITICAL, "the due rule should have been evaluated");
  assert.equal(refreshedNotDue.state, AlertState.OK, "the not-due rule should be untouched");
  assert.equal(refreshedPaused.state, AlertState.OK, "the paused rule should never be evaluated");
});
