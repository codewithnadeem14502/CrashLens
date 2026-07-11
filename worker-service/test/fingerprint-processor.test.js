const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateFingerprint } = require("../src/processors/fingerprint-processor");

// Smoke test proving the node:test runner is wired up correctly for
// worker-service (package.json's "test" script previously just exited 1).
// Exercises generateFingerprint, a small pure function, so this doesn't
// need a Mongo/RabbitMQ connection to run.

test("generateFingerprint is deterministic for identical input", () => {
  const input = {
    projectId: "proj-1",
    environment: "production",
    event: { type: "error", errorName: "TypeError" },
    normalizedMessage: "cannot read property foo of undefined",
    culprit: "src/index.js:10",
  };

  const first = generateFingerprint(input);
  const second = generateFingerprint(input);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.fingerprintVersion, "v1");
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
});

test("generateFingerprint differs when errorName differs", () => {
  const base = {
    projectId: "proj-1",
    environment: "production",
    event: { type: "error", errorName: "TypeError" },
    normalizedMessage: "cannot read property foo of undefined",
    culprit: "src/index.js:10",
  };

  const other = {
    ...base,
    event: { ...base.event, errorName: "RangeError" },
  };

  const a = generateFingerprint(base);
  const b = generateFingerprint(other);

  assert.notEqual(a.fingerprint, b.fingerprint);
});
