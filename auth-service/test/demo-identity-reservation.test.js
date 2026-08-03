const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

// Regression test for the demo-identity squatting hole found in the
// demo-login security review: POST /api/auth/organizations is public, and
// derives its slug with the same slugify() demoLogin uses to *find* the
// demo org. Without a guard, a stranger could register "CrashLens Demo"
// before the seed script ran and have every demo-login visitor dropped
// into a workspace they control (attacker-authored project names, issue
// titles and log lines rendered under our branding).
//
// No Mongo needed: the guard must reject before any Organization lookup.
const app = require("../src/app");

const savedEnv = {};
const ENV_KEYS = ["DEMO_LOGIN_ENABLED", "DEMO_ORG_SLUG", "DEMO_USER_EMAIL"];

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.DEMO_LOGIN_ENABLED = "true";
  process.env.DEMO_ORG_SLUG = "crashlens-demo";
  process.env.DEMO_USER_EMAIL = "demo@crashlens.online";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const register = (organizationName, email) =>
  request(app)
    .post("/api/auth/organizations")
    .send({
      organizationName,
      admin: { name: "Squatter", email, password: "Passw0rdd" },
    });

test("refuses to register an organization whose slug is the demo org's", async () => {
  const res = await register("CrashLens Demo", "attacker@example.com");

  assert.equal(res.status, 409);
});

test("the slug guard is not defeated by casing or punctuation", async () => {
  // slugify() normalizes all of these onto "crashlens-demo".
  for (const name of ["crashlens demo", "CRASHLENS   DEMO", "CrashLens-Demo"]) {
    const res = await register(name, "attacker@example.com");
    assert.equal(res.status, 409, `expected "${name}" to be reserved`);
  }
});

test("refuses to register using the demo account's email address", async () => {
  const res = await register("Totally Unrelated Org", "demo@crashlens.online");

  assert.equal(res.status, 409);
});

test("the email guard is case-insensitive", async () => {
  const res = await register("Totally Unrelated Org", "DEMO@CrashLens.Online");

  assert.equal(res.status, 409);
});

test("nothing is reserved when demo login is disabled", async () => {
  process.env.DEMO_LOGIN_ENABLED = "false";

  // Reaches the real handler (and then a DB call this test can't satisfy)
  // rather than being short-circuited by the reservation guard - a 409
  // here would mean the guard fired with the demo feature off.
  const res = await register("CrashLens Demo", "demo@crashlens.online");

  assert.notEqual(res.status, 409);
});
