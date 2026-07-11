const { test } = require("node:test");
const assert = require("node:assert/strict");
const { redactSensitiveFields } = require("../src/utils/constants");

// Module 7 review finding: event-service's SENSITIVE_KEYS was missing
// "authorization"/"cookie"/"dsnPublicKey" (issue-service already redacted
// all three) - a real gap since Module 7's new logs[].context field is the
// first fully free-form, producer-controlled object flowing through this
// service's request-logging middleware at high per-log-line volume.

test("redacts an authorization key nested inside an arbitrary context object", () => {
  const redacted = redactSensitiveFields({
    dsn: "crashlens://key@host/project",
    logs: [{ context: { authorization: "Bearer secret-token" } }],
  });

  assert.equal(redacted.logs[0].context.authorization, "[REDACTED]");
});

test("redacts a cookie key nested inside an arbitrary context object", () => {
  const redacted = redactSensitiveFields({
    logs: [{ context: { cookie: "session=abc123" } }],
  });

  assert.equal(redacted.logs[0].context.cookie, "[REDACTED]");
});

test("redacts dsnPublicKey", () => {
  const redacted = redactSensitiveFields({ dsnPublicKey: "pk_live_abc" });
  assert.equal(redacted.dsnPublicKey, "[REDACTED]");
});

test("still redacts the pre-existing keys (dsn, token, password, etc.)", () => {
  const redacted = redactSensitiveFields({
    dsn: "crashlens://key@host/project",
    token: "abc",
    password: "hunter2",
  });

  assert.equal(redacted.dsn, "[REDACTED]");
  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.password, "[REDACTED]");
});

test("does not redact unrelated context keys", () => {
  const redacted = redactSensitiveFields({
    logs: [{ context: { orderId: "ord_123" } }],
  });

  assert.equal(redacted.logs[0].context.orderId, "ord_123");
});
