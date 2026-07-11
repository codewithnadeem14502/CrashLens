const { AlertRule } = require("../models/alert-rule-model");
const { AlertEvent } = require("../models/alert-event-model");
// Called through the module object (queryExecutor.executeQuery /
// .executeQueryWithChange), not destructured - same reasoning as
// notifications/dispatcher.js's emailAction/webhookAction calls: lets
// node:test's mock.method(queryExecutor, "executeQuery", fn) substitute a
// mocked query result in tests without a destructured import keeping a
// stale reference to the original function.
const queryExecutor = require("../query/query-executor");
const { dispatchNotifications } = require("../notifications/dispatcher");
const { AlertState, ThresholdType, ThresholdDirection, RuleStatus } = require("../utils/constants");
const logger = require("../utils/logger");

const EVALUATION_SWEEP_INTERVAL_MS = Number.parseInt(
  process.env.ALERT_EVALUATION_SWEEP_INTERVAL_MS || "15000",
  10,
);

let intervalHandle = null;
let isRunning = false;

// Which state the rule's thresholds say the current value maps to, taken
// in isolation - the hysteresis (why the rule doesn't necessarily move to
// this state immediately) lives in resolveNextState below, which compares
// this "raw" read against the rule's currently persisted state.
const rawLevelForValue = (value, direction, { warningThreshold, criticalThreshold }) => {
  const crossed = (threshold) =>
    threshold != null &&
    (direction === ThresholdDirection.ABOVE ? value >= threshold : value <= threshold);

  if (crossed(criticalThreshold)) {
    return AlertState.CRITICAL;
  }

  if (crossed(warningThreshold)) {
    return AlertState.WARNING;
  }

  return AlertState.OK;
};

// Hysteresis: once a rule has left ok, it doesn't snap back just because
// the value dips back under warningThreshold - it has to cross the
// dedicated, less-sensitive resolveThreshold. This is the "configurable
// resolve threshold" from the module brief, and is what stops a value
// oscillating right at the boundary from re-firing/re-resolving every
// evaluation tick.
const resolveNextState = (currentState, value, direction, rule) => {
  const rawLevel = rawLevelForValue(value, direction, rule);

  if (currentState === AlertState.OK) {
    return rawLevel;
  }

  const isResolved =
    direction === ThresholdDirection.ABOVE
      ? value < rule.resolveThreshold
      : value > rule.resolveThreshold;

  if (isResolved) {
    return AlertState.OK;
  }

  // Inside the hysteresis band (past the resolve boundary but the raw
  // computation would otherwise say "ok"): hold the current non-ok state
  // rather than resolving early. Otherwise reflect the raw
  // escalation/de-escalation between warning and critical.
  return rawLevel === AlertState.OK ? currentState : rawLevel;
};

const thresholdCrossedFor = (rule, nextState) => {
  if (nextState === AlertState.CRITICAL) {
    return rule.criticalThreshold;
  }

  if (nextState === AlertState.WARNING) {
    return rule.warningThreshold;
  }

  return rule.resolveThreshold;
};

const evaluateRule = async (rule, now) => {
  let value;

  try {
    if (rule.thresholdType === ThresholdType.PERCENT_CHANGE) {
      const result = await queryExecutor.executeQueryWithChange(rule.query, rule.organizationId, now);
      value = result.percentChange;
    } else {
      const result = await queryExecutor.executeQuery(rule.query, rule.organizationId, now);
      value = result.value;
    }
  } catch (error) {
    logger.warn(`Alert rule ${rule._id} evaluation query failed: ${error.message}`);
    // Still advance nextEvaluationAt - a failed tick must make room for
    // the next one rather than retry-looping against a possibly-down
    // upstream every sweep interval - but never touch state on a failed
    // read: a transient upstream failure must not fire or resolve an
    // alert based on no real data.
    rule.nextEvaluationAt = new Date(now.getTime() + rule.evaluationIntervalSeconds * 1000);
    await rule.save();
    return null;
  }

  const previousState = rule.state;
  const nextState = resolveNextState(previousState, value, rule.direction, rule);

  rule.lastValue = value;
  rule.lastEvaluatedAt = now;
  rule.nextEvaluationAt = new Date(now.getTime() + rule.evaluationIntervalSeconds * 1000);

  if (nextState === previousState) {
    // Idempotent: identical state as last tick - no event, no
    // notification, no double-fire.
    await rule.save();
    return null;
  }

  if (nextState !== AlertState.OK) {
    rule.lastTriggeredAt = now;
  }

  rule.state = nextState;
  await rule.save();

  const notificationContext = {
    ruleId: rule._id.toString(),
    ruleName: rule.name,
    fromState: previousState,
    toState: nextState,
    value,
    triggeredAt: now,
  };

  const notifications = rule.notificationActions.length
    ? await dispatchNotifications(rule.notificationActions, notificationContext)
    : [];

  await AlertEvent.create({
    ruleId: rule._id,
    organizationId: rule.organizationId,
    projectId: rule.projectId,
    ruleName: rule.name,
    fromState: previousState,
    toState: nextState,
    value,
    thresholdCrossed: thresholdCrossedFor(rule, nextState),
    notifications,
    triggeredAt: now,
  });

  return { previousState, nextState, value };
};

const runSweep = async (now = new Date()) => {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    const dueRules = await AlertRule.find({
      status: RuleStatus.ACTIVE,
      nextEvaluationAt: { $lte: now },
    });

    await Promise.allSettled(dueRules.map((rule) => evaluateRule(rule, now)));
  } catch (error) {
    logger.error(`Alert evaluation sweep failed: ${error.message}`);
  } finally {
    isRunning = false;
  }
};

const startAlertEvaluator = () => {
  if (intervalHandle) {
    return;
  }

  intervalHandle = setInterval(() => {
    runSweep().catch((error) => logger.error(`Alert evaluation sweep failed: ${error.message}`));
  }, EVALUATION_SWEEP_INTERVAL_MS);
};

const stopAlertEvaluator = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};

module.exports = {
  startAlertEvaluator,
  stopAlertEvaluator,
  runSweep,
  evaluateRule,
  resolveNextState,
  rawLevelForValue,
};
