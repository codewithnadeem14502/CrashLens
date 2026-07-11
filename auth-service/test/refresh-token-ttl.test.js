const { test } = require("node:test");
const assert = require("node:assert/strict");
const RefreshToken = require("../src/models/refresh-token-model");

// Regression test for the Module 1 P1 fix: expiresAt previously had
// `index: true` (a lookup index) but no TTL option, so MongoDB never
// actually deleted expired refresh tokens. Mongoose exposes schema-declared
// indexes synchronously without needing a live DB connection.

test("expiresAt carries a TTL index (expireAfterSeconds: 0)", () => {
  const indexes = RefreshToken.schema.indexes();
  const expiresAtIndex = indexes.find(
    ([fields]) => Object.keys(fields).length === 1 && fields.expiresAt === 1,
  );

  assert.ok(expiresAtIndex, "expected a single-field index on expiresAt");

  const [, options] = expiresAtIndex;
  assert.equal(
    options.expireAfterSeconds,
    0,
    "expiresAt index must set expireAfterSeconds so MongoDB auto-deletes expired tokens",
  );
});
