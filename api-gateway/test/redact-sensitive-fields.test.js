const { test } = require("node:test");
const assert = require("node:assert/strict");
const { redactSensitiveFields } = require("../src/utils/constants");

// Module 8 security review finding: the gateway's request-logging
// middleware previously logged req.body with zero redaction - the gateway
// sees every request FIRST, before any downstream service's own redaction
// runs, so login passwords (POST /v1/auth/login) and, since Module 8,
// monitor check-in tokens (re-sent automatically and repeatedly by
// external cron jobs) were both written to combine.log in cleartext.

test("redacts a login password", () => {
  const redacted = redactSensitiveFields({ email: "a@b.com", password: "hunter2" });
  assert.equal(redacted.password, "[REDACTED]");
  assert.equal(redacted.email, "a@b.com");
});

test("redacts a monitor check-in token", () => {
  const redacted = redactSensitiveFields({ token: "b83adc9eb43061dddd2184daf67431cd2ce44749f7f2d921", status: "ok" });
  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.status, "ok");
});

test("redacts conventionally-cased header keys (Authorization, Cookie), not just lowercase", () => {
  const redacted = redactSensitiveFields({
    headers: { Authorization: "Bearer secret", Cookie: "session=abc", "Content-Type": "application/json" },
  });

  assert.equal(redacted.headers.Authorization, "[REDACTED]");
  assert.equal(redacted.headers.Cookie, "[REDACTED]");
  assert.equal(redacted.headers["Content-Type"], "application/json");
});

test("does not redact unrelated fields", () => {
  const redacted = redactSensitiveFields({ name: "My Monitor", url: "https://example.com" });
  assert.equal(redacted.name, "My Monitor");
  assert.equal(redacted.url, "https://example.com");
});

test("handles a null/undefined body without throwing", () => {
  assert.equal(redactSensitiveFields(undefined), undefined);
  assert.equal(redactSensitiveFields(null), null);
});
