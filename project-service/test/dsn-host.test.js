const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { buildDsn } = require("../src/utils/dsn");

// Regression test for the production bug where every project's DSN read
// "crashlens://<key>@localhost:3003/<projectId>" - unusable by any real
// app, and pointing at event-service's own port rather than the gateway
// (which would bypass rate limiting even if it did resolve). Two causes:
// PUBLIC_DSN_HOST was never set in any compose file, and the fallback
// pointed at the wrong service.

let savedHost;

beforeEach(() => {
  savedHost = process.env.PUBLIC_DSN_HOST;
});

afterEach(() => {
  if (savedHost === undefined) delete process.env.PUBLIC_DSN_HOST;
  else process.env.PUBLIC_DSN_HOST = savedHost;
});

test("uses PUBLIC_DSN_HOST as the DSN host segment", () => {
  process.env.PUBLIC_DSN_HOST = "api.crashlens.online";

  const dsn = buildDsn({ publicKey: "abc123", projectId: "64b7f0c2e1" });

  assert.equal(dsn, "crashlens://abc123@api.crashlens.online/64b7f0c2e1");
});

test("the host is read per call, so a deployment change applies to existing projects", () => {
  process.env.PUBLIC_DSN_HOST = "first.example.com";
  const before = buildDsn({ publicKey: "k", projectId: "p" });

  process.env.PUBLIC_DSN_HOST = "second.example.com";
  const after = buildDsn({ publicKey: "k", projectId: "p" });

  // Not captured at module load: buildDsn is called on every DSN read
  // (project-controller's buildProjectDsnPayload), which is what lets
  // setting PUBLIC_DSN_HOST heal DSNs stored before it was configured.
  assert.notEqual(before, after);
  assert.match(after, /@second\.example\.com\//);
});

test("the local-dev fallback is the gateway, never event-service's port", () => {
  delete process.env.PUBLIC_DSN_HOST;

  const dsn = buildDsn({ publicKey: "k", projectId: "p" });

  assert.doesNotMatch(
    dsn,
    /:3003/,
    "3003 is event-service's own port - a DSN must point at the api-gateway",
  );
  assert.match(dsn, /@localhost:3000\//);
});

test("the built DSN parses as the SDK's validator expects", () => {
  process.env.PUBLIC_DSN_HOST = "api.crashlens.online";

  const parsed = new URL(
    buildDsn({ publicKey: "abc123", projectId: "64b7f0c2e1" }),
  );

  assert.equal(parsed.protocol, "crashlens:");
  assert.equal(parsed.username, "abc123");
  assert.equal(parsed.hostname, "api.crashlens.online");
  assert.equal(parsed.pathname.replace(/^\/+/, ""), "64b7f0c2e1");
});
