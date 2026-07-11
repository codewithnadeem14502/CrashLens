const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

// Proves the node:test + supertest wiring works end to end for
// issue-service, and that src/app.js is side-effect-free (no DB/queue
// connect) so it can be driven directly without live Mongo/RabbitMQ.
const app = require("../src/app");

test("GET /health returns ok without needing a DB/queue connection", async () => {
  const res = await request(app).get("/health");

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.service, "issue-service");
});
