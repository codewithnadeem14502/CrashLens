const { test } = require("node:test");
const assert = require("node:assert/strict");

// tokens.js reads process.env.JWT_SECRET lazily inside getJwtSecret(), so
// set it before requiring the module.
process.env.JWT_SECRET = "test-only-secret-do-not-use-in-real-deployments";

const { signAccessToken, verifyAccessToken } = require("../src/utils/tokens");

test("sign/verify round trip works with a real JWT_SECRET", () => {
  const token = signAccessToken({
    user: { _id: "507f1f77bcf86cd799439099" },
    membership: {
      _id: "507f1f77bcf86cd799439022",
      organizationId: "507f1f77bcf86cd799439011",
      role: "admin",
    },
    permissions: ["*"],
  });

  const payload = verifyAccessToken(token);

  assert.equal(payload.sub, "507f1f77bcf86cd799439099");
  assert.equal(payload.organizationId, "507f1f77bcf86cd799439011");
  assert.equal(payload.role, "admin");
});

test("no hardcoded fallback: signing throws if JWT_SECRET is unset", () => {
  const original = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;

  try {
    assert.throws(() =>
      signAccessToken({
        user: { _id: "507f1f77bcf86cd799439099" },
        membership: {
          _id: "507f1f77bcf86cd799439022",
          organizationId: "507f1f77bcf86cd799439011",
          role: "admin",
        },
        permissions: [],
      }),
    );
  } finally {
    process.env.JWT_SECRET = original;
  }
});
