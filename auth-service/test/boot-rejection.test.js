const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

// Black-box proof that the assertJwtSecret guard is actually wired into
// server.js's boot sequence (not just unit-testable in isolation): spawn
// the real process with an insecure JWT_SECRET and confirm it exits
// non-zero *before* trying to connect to Mongo/RabbitMQ. This is the one
// representative end-to-end boot test for the pattern - project-service and
// issue-service wire the identical guard the same way (see their own
// assertJwtSecret.test.js for the unit-level coverage), so this isn't
// repeated as a second process-spawn per service.

const SERVER_ENTRY = path.join(__dirname, "..", "src", "server.js");

const runWithSecret = (jwtSecret) =>
  spawnSync(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      JWT_SECRET: jwtSecret,
      PORT: "0",
    },
    timeout: 5000,
    encoding: "utf8",
  });

test("refuses to boot when JWT_SECRET is unset", () => {
  const envWithoutSecret = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== "JWT_SECRET"),
  );

  const { status, stdout, stderr } = spawnSync(process.execPath, [SERVER_ENTRY], {
    env: envWithoutSecret,
    timeout: 5000,
    encoding: "utf8",
  });

  assert.notEqual(status, 0);
  // Winston's Console transport writes everything (including .error() calls)
  // to stdout by default, not stderr - assert against whichever stream
  // actually carries it rather than assuming Node convention.
  assert.match(stdout + stderr, /FATAL/);
});

test("refuses to boot when JWT_SECRET is the known default placeholder", () => {
  const { status, stdout, stderr } = runWithSecret(
    "dev-auth-service-secret-change-me",
  );

  assert.notEqual(status, 0);
  assert.match(stdout + stderr, /FATAL/);
});
