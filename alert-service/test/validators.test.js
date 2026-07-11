const { test } = require("node:test");
const assert = require("node:assert/strict");
const { queryDefinitionSchema } = require("../src/validators/query-validator");
const { createAlertRuleSchema, updateAlertRuleSchema } = require("../src/validators/alert-rule-validator");

test("queryDefinitionSchema rejects a dataset/aggregate combination that isn't valid", () => {
  const { error } = queryDefinitionSchema.validate({
    dataset: "issues",
    aggregate: "p95_duration_ms",
    timeWindowMinutes: 60,
  });
  assert.ok(error);
});

test("queryDefinitionSchema rejects unknown filter fields (never a raw passthrough)", () => {
  const { error } = queryDefinitionSchema.validate({
    dataset: "issues",
    aggregate: "count",
    filters: { severity: "critical", "$where": "evil" },
    timeWindowMinutes: 60,
  });
  assert.ok(error);
  assert.match(error.message, /not allowed/);
});

test("queryDefinitionSchema accepts a valid transactions p95 query", () => {
  const { error } = queryDefinitionSchema.validate({
    dataset: "transactions",
    aggregate: "p95_duration_ms",
    filters: { endpointId: "GET /checkout" },
    timeWindowMinutes: 30,
  });
  assert.equal(error, undefined);
});

const validQuery = { dataset: "issues", aggregate: "count", timeWindowMinutes: 60 };

test("createAlertRuleSchema rejects a rule with neither warningThreshold nor criticalThreshold", () => {
  const { error } = createAlertRuleSchema.body.validate({
    name: "No thresholds",
    query: validQuery,
    thresholdType: "static",
    direction: "above",
    resolveThreshold: 5,
  });
  assert.ok(error);
  assert.match(error.message, /at least one of warningThreshold or criticalThreshold/);
});

test("createAlertRuleSchema rejects a resolveThreshold that doesn't create real hysteresis (direction=above)", () => {
  const { error } = createAlertRuleSchema.body.validate({
    name: "Bad resolve threshold",
    query: validQuery,
    thresholdType: "static",
    direction: "above",
    warningThreshold: 10,
    resolveThreshold: 10, // must be strictly less than warningThreshold
  });
  assert.ok(error);
  assert.match(error.message, /resolveThreshold must be less than/);
});

test("createAlertRuleSchema accepts a well-formed static rule with only criticalThreshold set", () => {
  const { error } = createAlertRuleSchema.body.validate({
    name: "Critical only",
    query: validQuery,
    thresholdType: "static",
    direction: "above",
    criticalThreshold: 20,
    resolveThreshold: 5,
  });
  assert.equal(error, undefined);
});

test("createAlertRuleSchema rejects a webhook notification target pointing at a private address", () => {
  const { error } = createAlertRuleSchema.body.validate({
    name: "SSRF via webhook",
    query: validQuery,
    thresholdType: "static",
    direction: "above",
    warningThreshold: 10,
    resolveThreshold: 5,
    notificationActions: [{ type: "webhook", target: "http://169.254.169.254/" }],
  });
  assert.ok(error);
  assert.match(error.message, /private, loopback/);
});

test("createAlertRuleSchema rejects an email notification target that isn't a valid email", () => {
  const { error } = createAlertRuleSchema.body.validate({
    name: "Bad email",
    query: validQuery,
    thresholdType: "static",
    direction: "above",
    warningThreshold: 10,
    resolveThreshold: 5,
    notificationActions: [{ type: "email", target: "not-an-email" }],
  });
  assert.ok(error);
});

test("createAlertRuleSchema accepts valid email and webhook notification actions together", () => {
  const { error } = createAlertRuleSchema.body.validate({
    name: "Valid notifications",
    query: validQuery,
    thresholdType: "static",
    direction: "above",
    warningThreshold: 10,
    resolveThreshold: 5,
    notificationActions: [
      { type: "email", target: "oncall@example.com" },
      { type: "webhook", target: "https://hooks.example.com/incoming" },
    ],
  });
  assert.equal(error, undefined);
});

test("updateAlertRuleSchema allows a status-only pause without resending thresholds", () => {
  const { error } = updateAlertRuleSchema.body.validate({ status: "paused" });
  assert.equal(error, undefined);
});

test("updateAlertRuleSchema requires direction+resolveThreshold together when touching a threshold field", () => {
  const { error } = updateAlertRuleSchema.body.validate({ warningThreshold: 15 });
  assert.ok(error);
  assert.match(error.message, /direction and resolveThreshold must be included together/);
});

test("updateAlertRuleSchema re-validates hysteresis when a full threshold set is provided", () => {
  const { error } = updateAlertRuleSchema.body.validate({
    direction: "above",
    warningThreshold: 10,
    resolveThreshold: 50, // wrong side
  });
  assert.ok(error);
});
