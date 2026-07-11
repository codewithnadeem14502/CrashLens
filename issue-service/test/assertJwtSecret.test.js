const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertJwtSecret,
  KNOWN_DEFAULT_JWT_SECRET,
} = require("../src/utils/assertJwtSecret");

// Regression test for the Module 1 P0 fix: auth-service, project-service, and
// issue-service used to fall back to this exact hardcoded string when
// JWT_SECRET was unset, letting anyone forge a token accepted by all three.
// The guard must now throw (and server.js must refuse to boot) for every
// unsafe value.

test("throws when JWT_SECRET is unset", () => {
  const original = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;

  try {
    assert.throws(() => assertJwtSecret(), /JWT_SECRET is not set/);
  } finally {
    if (original === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = original;
    }
  }
});

test("throws when JWT_SECRET is an empty string", () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "   ";

  try {
    assert.throws(() => assertJwtSecret(), /JWT_SECRET is not set/);
  } finally {
    if (original === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = original;
    }
  }
});

test("throws when JWT_SECRET is still the known default placeholder", () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = KNOWN_DEFAULT_JWT_SECRET;

  try {
    assert.throws(() => assertJwtSecret(), /known default placeholder/);
  } finally {
    if (original === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = original;
    }
  }
});

test("does not throw for a real secret", () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "a-sufficiently-random-production-secret-value";

  try {
    assert.doesNotThrow(() => assertJwtSecret());
  } finally {
    if (original === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = original;
    }
  }
});
