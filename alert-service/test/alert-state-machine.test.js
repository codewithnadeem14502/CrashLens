const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveNextState, rawLevelForValue } = require("../src/jobs/alert-evaluator");
const { AlertState, ThresholdDirection } = require("../src/utils/constants");

const aboveRule = { warningThreshold: 10, criticalThreshold: 20, resolveThreshold: 5 };

test("rawLevelForValue: below warning is ok, at/above warning is warning, at/above critical is critical (direction=above)", () => {
  assert.equal(rawLevelForValue(9, ThresholdDirection.ABOVE, aboveRule), AlertState.OK);
  assert.equal(rawLevelForValue(10, ThresholdDirection.ABOVE, aboveRule), AlertState.WARNING);
  assert.equal(rawLevelForValue(19, ThresholdDirection.ABOVE, aboveRule), AlertState.WARNING);
  assert.equal(rawLevelForValue(20, ThresholdDirection.ABOVE, aboveRule), AlertState.CRITICAL);
  assert.equal(rawLevelForValue(100, ThresholdDirection.ABOVE, aboveRule), AlertState.CRITICAL);
});

test("rawLevelForValue: direction=below inverts the comparison", () => {
  const belowRule = { warningThreshold: 50, criticalThreshold: 20, resolveThreshold: 80 };
  assert.equal(rawLevelForValue(60, ThresholdDirection.BELOW, belowRule), AlertState.OK);
  assert.equal(rawLevelForValue(50, ThresholdDirection.BELOW, belowRule), AlertState.WARNING);
  assert.equal(rawLevelForValue(20, ThresholdDirection.BELOW, belowRule), AlertState.CRITICAL);
});

test("rawLevelForValue: a null threshold is simply never crossed", () => {
  const criticalOnly = { warningThreshold: null, criticalThreshold: 20, resolveThreshold: 5 };
  assert.equal(rawLevelForValue(15, ThresholdDirection.ABOVE, criticalOnly), AlertState.OK);
  assert.equal(rawLevelForValue(20, ThresholdDirection.ABOVE, criticalOnly), AlertState.CRITICAL);
});

test("resolveNextState: ok -> warning -> critical escalation, and a single-tick jump straight to critical", () => {
  assert.equal(resolveNextState(AlertState.OK, 12, ThresholdDirection.ABOVE, aboveRule), AlertState.WARNING);
  assert.equal(
    resolveNextState(AlertState.WARNING, 25, ThresholdDirection.ABOVE, aboveRule),
    AlertState.CRITICAL,
  );
  assert.equal(resolveNextState(AlertState.OK, 25, ThresholdDirection.ABOVE, aboveRule), AlertState.CRITICAL);
});

test("resolveNextState: hysteresis band - dropping below warningThreshold but still above resolveThreshold does NOT resolve", () => {
  // warningThreshold=10, resolveThreshold=5 - value=7 is below warning but
  // above resolve, so a rule already at warning must stay at warning.
  assert.equal(resolveNextState(AlertState.WARNING, 7, ThresholdDirection.ABOVE, aboveRule), AlertState.WARNING);
});

test("resolveNextState: crossing resolveThreshold actually resolves to ok", () => {
  assert.equal(resolveNextState(AlertState.WARNING, 3, ThresholdDirection.ABOVE, aboveRule), AlertState.OK);
});

test("resolveNextState: critical de-escalates to warning (not straight to ok) once below critical but still above resolveThreshold", () => {
  assert.equal(resolveNextState(AlertState.CRITICAL, 12, ThresholdDirection.ABOVE, aboveRule), AlertState.WARNING);
});

test("resolveNextState: critical can resolve directly to ok if the value fully recovers in one tick", () => {
  assert.equal(resolveNextState(AlertState.CRITICAL, 2, ThresholdDirection.ABOVE, aboveRule), AlertState.OK);
});

test("resolveNextState: repeated evaluations at the same value never change state (idempotent state machine)", () => {
  let state = AlertState.OK;
  state = resolveNextState(state, 25, ThresholdDirection.ABOVE, aboveRule);
  assert.equal(state, AlertState.CRITICAL);

  // Ticking again at the exact same value must yield the exact same state,
  // over and over - this is what makes the caller's "only act on a state
  // transition" logic safe/idempotent.
  for (let i = 0; i < 5; i += 1) {
    state = resolveNextState(state, 25, ThresholdDirection.ABOVE, aboveRule);
    assert.equal(state, AlertState.CRITICAL);
  }
});

test("resolveNextState: direction=below hysteresis (e.g. a healthy-request count dropping)", () => {
  const belowRule = { warningThreshold: 50, criticalThreshold: 20, resolveThreshold: 80 };
  assert.equal(resolveNextState(AlertState.OK, 40, ThresholdDirection.BELOW, belowRule), AlertState.WARNING);
  // Recovered above warning (50) but still below resolveThreshold (80) -
  // must stay at warning, not resolve early.
  assert.equal(resolveNextState(AlertState.WARNING, 60, ThresholdDirection.BELOW, belowRule), AlertState.WARNING);
  assert.equal(resolveNextState(AlertState.WARNING, 85, ThresholdDirection.BELOW, belowRule), AlertState.OK);
});
