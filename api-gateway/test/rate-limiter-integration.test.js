const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

// Isolated env for this file only (node:test runs each file in its own
// process): a low limit + a unique key prefix so this doesn't collide with
// any other rate-limit counters in the shared Redis instance, and doesn't
// need to fire 300 requests to prove the limiter works.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-do-not-use-in-real-deployments";
process.env.RATE_LIMIT_MAX_REQUESTS = "3";
process.env.RATE_LIMIT_WINDOW_MS = "60000";
process.env.RATE_LIMIT_KEY_PREFIX = `rl:test:${process.pid}:${Date.now()}:`;
process.env.ISSUE_SERVICE_URL = "http://127.0.0.1:19999"; // unused in this test
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:19999";
process.env.PROJECT_SERVICE_URL = "http://127.0.0.1:19999";
process.env.EVENT_SERVICE_URL = "http://127.0.0.1:19999";
process.env.MONITOR_SERVICE_URL = "http://127.0.0.1:19999"; // unused in this test
process.env.ALERT_SERVICE_URL = "http://127.0.0.1:19999"; // unused in this test

const app = require("../src/app");
const { redisClient } = require("../src/middleware/rateLimiter");

after(async () => {
  // Clean up this run's isolated keys and close the connection so the test
  // process can exit.
  const keys = await redisClient.keys(`${process.env.RATE_LIMIT_KEY_PREFIX}*`);
  if (keys.length) {
    await redisClient.del(keys);
  }
  redisClient.disconnect();
});

test("returns 429 once a client exceeds the configured request limit", async () => {
  // Hit an ingestion path (JWT-exempt) so this test only exercises rate
  // limiting, not JWT verification. The upstream is unreachable, so
  // requests within the limit will fail with a proxy error (5xx) rather
  // than succeeding - that's fine, the rate limiter runs before the proxy.
  const responses = [];

  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app).get("/v1/events/does-not-matter");
    responses.push(res.status);
  }

  assert.notEqual(
    responses[3],
    responses[0],
    "expected the 4th request (over the limit of 3) to be rate-limited",
  );
  assert.equal(responses[3], 429);
  assert.ok(
    responses.slice(0, 3).every((status) => status !== 429),
    `expected the first 3 requests to not be rate-limited, got: ${responses}`,
  );
});
