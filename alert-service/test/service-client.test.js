const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-do-not-use-in-real-deployments";
process.env.ACCESS_TOKEN_ISSUER =
  process.env.ACCESS_TOKEN_ISSUER || "crash-lens-auth-service";

// A tiny local HTTP server standing in for issue-service, so the real
// callService/fetch path is exercised (not mocked) - this is what
// backend-review flagged: callService used to flatten every non-2xx
// upstream response to a 502, hiding a genuine 400 (e.g. an invalid
// filter value) behind a misleading "upstream unreachable" status.
let server;
let responseMode = "ok";

before(async () => {
  server = http.createServer((req, res) => {
    if (responseMode === "ok") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { pagination: { total: 1 } } }));
    } else if (responseMode === "bad-request") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, message: "Invalid request query", details: ["\"severity\" must be one of [low, medium, high, critical]"] }));
    } else if (responseMode === "server-error") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, message: "Internal server error" }));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ISSUE_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  responseMode = "ok";
});

test("a 400 from upstream propagates as a 400 with the real validation message, not a flattened 502", async () => {
  responseMode = "bad-request";
  // Required fresh per test since ISSUE_SERVICE_URL is read at module load
  // time by service-client.js's top-level const - re-require after setting
  // the env var in `before()` isn't enough on its own, so this file sets
  // the port before the first require of service-client.js below runs.
  delete require.cache[require.resolve("../src/query/service-client")];
  const serviceClient = require("../src/query/service-client");

  await assert.rejects(
    () => serviceClient.listIssues("507f1f77bcf86cd799439011", { severity: "bogus" }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Invalid request query");
      assert.deepEqual(error.details, ["\"severity\" must be one of [low, medium, high, critical]"]);
      return true;
    },
  );
});

test("a 500 from upstream becomes a 502 (a real upstream failure, not the caller's fault)", async () => {
  responseMode = "server-error";
  delete require.cache[require.resolve("../src/query/service-client")];
  const serviceClient = require("../src/query/service-client");

  await assert.rejects(
    () => serviceClient.listIssues("507f1f77bcf86cd799439011", {}),
    (error) => {
      assert.equal(error.statusCode, 502);
      return true;
    },
  );
});

test("an unreachable upstream (connection refused) becomes a 502", async () => {
  process.env.ISSUE_SERVICE_URL = "http://127.0.0.1:1";
  delete require.cache[require.resolve("../src/query/service-client")];
  const serviceClient = require("../src/query/service-client");

  await assert.rejects(
    () => serviceClient.listIssues("507f1f77bcf86cd799439011", {}),
    (error) => {
      assert.equal(error.statusCode, 502);
      return true;
    },
  );

  process.env.ISSUE_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
});
