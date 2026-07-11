const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeNextExpectedAt, validateCrontab } = require("../src/utils/schedule");

test("interval schedule: next expected is fromDate + intervalSeconds", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const next = computeNextExpectedAt({ scheduleType: "interval", intervalSeconds: 300 }, from);
  assert.equal(next.toISOString(), "2026-01-01T00:05:00.000Z");
});

test("crontab schedule: next expected matches the cron expression", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const next = computeNextExpectedAt(
    { scheduleType: "crontab", crontab: "0 * * * *", timezone: "UTC" },
    from,
  );
  assert.equal(next.toISOString(), "2026-01-01T01:00:00.000Z");
});

test("crontab schedule: throws ApiError(400) for a malformed expression", () => {
  assert.throws(
    () =>
      computeNextExpectedAt(
        { scheduleType: "crontab", crontab: "not a cron expression", timezone: "UTC" },
        new Date(),
      ),
    (error) => error.statusCode === 400 && /Invalid crontab expression/.test(error.message),
  );
});

test("validateCrontab returns true for a well-formed expression", () => {
  assert.equal(validateCrontab("*/5 * * * *"), true);
});

test("validateCrontab returns false for a malformed expression", () => {
  assert.equal(validateCrontab("garbage"), false);
});
