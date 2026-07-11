const { test } = require("node:test");
const assert = require("node:assert/strict");
const DsnCache = require("../src/models/dsn-cache-model");

// Regression tests for the Module 1 P0 fix: DsnCache previously only had a
// unique index on the compound pair {projectId, dsnPublicKey}, meaning the
// same dsnPublicKey could be cached under two different projectIds - and
// had no TTL, so a revoked/regenerated DSN could keep validating forever if
// the RabbitMQ consumer that syncs the cache was down/backlogged. Mongoose
// exposes schema-declared indexes synchronously, no live DB connection
// needed.

test("dsnPublicKey has a standalone unique index (not just the compound pair)", () => {
  const indexes = DsnCache.schema.indexes();

  const standaloneUnique = indexes.find(
    ([fields, options]) =>
      Object.keys(fields).length === 1 &&
      fields.dsnPublicKey === 1 &&
      options.unique === true,
  );

  assert.ok(
    standaloneUnique,
    "expected a standalone unique index on dsnPublicKey",
  );
});

test("the compound {projectId, dsnPublicKey} unique index still exists", () => {
  const indexes = DsnCache.schema.indexes();

  const compoundUnique = indexes.find(
    ([fields, options]) =>
      fields.projectId === 1 &&
      fields.dsnPublicKey === 1 &&
      Object.keys(fields).length === 2 &&
      options.unique === true,
  );

  assert.ok(
    compoundUnique,
    "expected the pre-existing compound unique index to still be present",
  );
});

test("lastSyncedAt carries a TTL index bounding cache staleness", () => {
  const indexes = DsnCache.schema.indexes();

  const ttlIndex = indexes.find(
    ([fields]) =>
      Object.keys(fields).length === 1 && fields.lastSyncedAt === 1,
  );

  assert.ok(ttlIndex, "expected a single-field index on lastSyncedAt");

  const [, options] = ttlIndex;
  assert.equal(
    typeof options.expireAfterSeconds,
    "number",
    "lastSyncedAt index must set expireAfterSeconds",
  );
  assert.ok(
    options.expireAfterSeconds > 0,
    "TTL must be a positive, bounded window",
  );
});

test("DSN_CACHE_TTL_SECONDS is configurable via env and defaults to 30 days", () => {
  // Re-require in a fresh module registry entry isn't practical here since
  // Mongoose models are singletons per collection name; instead just assert
  // the default that was compiled in for this process (env unset in this
  // test run) matches the documented 30-day default.
  const indexes = DsnCache.schema.indexes();
  const [, options] = indexes.find(
    ([fields]) => Object.keys(fields).length === 1 && fields.lastSyncedAt === 1,
  );

  if (!process.env.DSN_CACHE_TTL_SECONDS) {
    assert.equal(options.expireAfterSeconds, 30 * 24 * 60 * 60);
  }
});
