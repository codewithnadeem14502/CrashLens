const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

// Proves the node:test + supertest wiring works end to end for auth-service,
// and that src/app.js is a pure, side-effect-free Express app (no DB connect,
// no app.listen) that can be driven directly without a real Mongo connection.
const app = require("../src/app");

test("GET /health returns ok without needing a DB connection", async () => {
  const res = await request(app).get("/health");

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.service, "auth-service");
});
