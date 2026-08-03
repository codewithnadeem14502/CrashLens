const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

// DB-free coverage for POST /api/auth/demo-login, matching this service's
// existing test style (src/app.js is pure Express, no Mongo needed for
// these paths). The full happy path (org lookup, user/membership upsert,
// token issuance) needs a live Mongo + a provisioned demo org, and is
// exercised by the end-to-end demo seed flow (repo-root
// scripts/seed-demo.mjs) rather than mocked here.
const app = require("../src/app");

let originalDemoEnabled;

beforeEach(() => {
  originalDemoEnabled = process.env.DEMO_LOGIN_ENABLED;
});

afterEach(() => {
  if (originalDemoEnabled === undefined) {
    delete process.env.DEMO_LOGIN_ENABLED;
  } else {
    process.env.DEMO_LOGIN_ENABLED = originalDemoEnabled;
  }
});

test("answers 404 when DEMO_LOGIN_ENABLED is unset", async () => {
  delete process.env.DEMO_LOGIN_ENABLED;

  const res = await request(app).post("/api/auth/demo-login");

  assert.equal(res.status, 404);
  assert.match(res.body.message, /not enabled/i);
});

test("answers 404 when DEMO_LOGIN_ENABLED is any value other than the literal \"true\"", async () => {
  process.env.DEMO_LOGIN_ENABLED = "TRUE";

  const res = await request(app).post("/api/auth/demo-login");

  assert.equal(res.status, 404);
  assert.match(res.body.message, /not enabled/i);
});

test("the flag check runs before any DB access (disabled path needs no Mongo)", async () => {
  // This whole file runs without a Mongo connection - if the flag check
  // were ordered after the Organization lookup, these requests would hang
  // or 500 on a buffering timeout instead of returning 404 immediately.
  delete process.env.DEMO_LOGIN_ENABLED;

  const started = Date.now();
  const res = await request(app).post("/api/auth/demo-login");

  assert.equal(res.status, 404);
  assert.ok(
    Date.now() - started < 5000,
    "disabled demo-login must short-circuit before touching the DB",
  );
});

test("rejects a request body outright (the route reads no client input)", async () => {
  process.env.DEMO_LOGIN_ENABLED = "true";

  const res = await request(app)
    .post("/api/auth/demo-login")
    .send({ organizationSlug: "some-other-org" });

  // 400 from Joi, never a 200 that silently ignored the field - proves the
  // "no client input" property is enforced rather than just commented.
  assert.equal(res.status, 400);
});
