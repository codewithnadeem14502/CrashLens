const { test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

// tokens.js reads process.env.JWT_SECRET lazily inside getJwtSecret(), so
// set it before requiring the module.
process.env.JWT_SECRET = "test-only-secret-do-not-use-in-real-deployments";

const { verifyAccessToken } = require("../src/utils/tokens");

test("verifies a token signed with the matching secret and issuer", () => {
  const token = jwt.sign(
    {
      sub: "507f1f77bcf86cd799439099",
      organizationId: "507f1f77bcf86cd799439011",
      membershipId: "507f1f77bcf86cd799439022",
      role: "admin",
    },
    process.env.JWT_SECRET,
    { issuer: "crash-lens-auth-service" },
  );

  const payload = verifyAccessToken(token);
  assert.equal(payload.sub, "507f1f77bcf86cd799439099");
});

test("no hardcoded fallback: verification throws if JWT_SECRET is unset", () => {
  const original = process.env.JWT_SECRET;
  const token = jwt.sign({ sub: "x" }, original, {
    issuer: "crash-lens-auth-service",
  });
  delete process.env.JWT_SECRET;

  try {
    assert.throws(() => verifyAccessToken(token));
  } finally {
    process.env.JWT_SECRET = original;
  }
});
