const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertPublicUrl } = require("../src/utils/ssrfGuard");

// Copied from monitor-service/test/ssrfGuard.test.js (the guard itself is
// copied verbatim too - see src/utils/ssrfGuard.js's header comment). The
// webhook notification action performs outbound HTTP requests to a
// user-supplied URL (only an authenticated ALERT_MANAGE user can set it,
// but a compromised or malicious one could otherwise use alert-service as
// an SSRF proxy into the Docker network's internal services).

test("rejects localhost", () => {
  assert.throws(() => assertPublicUrl("http://localhost:6379/"), /private, loopback/);
});

test("rejects 127.0.0.1", () => {
  assert.throws(() => assertPublicUrl("http://127.0.0.1:27017/"), /private, loopback/);
});

test("rejects 10.x.x.x (RFC1918)", () => {
  assert.throws(() => assertPublicUrl("http://10.0.5.3/"), /private, loopback/);
});

test("rejects 172.16-31.x.x (RFC1918)", () => {
  assert.throws(() => assertPublicUrl("http://172.20.0.5/"), /private, loopback/);
  assert.doesNotThrow(() => assertPublicUrl("http://172.32.0.5/")); // outside the 16-31 range
});

test("rejects 192.168.x.x (RFC1918)", () => {
  assert.throws(() => assertPublicUrl("http://192.168.1.1/"), /private, loopback/);
});

test("rejects 169.254.x.x (link-local / cloud metadata)", () => {
  assert.throws(() => assertPublicUrl("http://169.254.169.254/latest/meta-data/"), /private, loopback/);
});

test("rejects .local mDNS hostnames", () => {
  assert.throws(() => assertPublicUrl("http://myservice.local/"), /private, loopback/);
});

test("rejects a malformed URL", () => {
  assert.throws(() => assertPublicUrl("not a url"), /url is invalid/);
});

test("allows a normal public https URL", () => {
  assert.doesNotThrow(() => assertPublicUrl("https://example.com/health"));
});

test("allows a public IP literal", () => {
  assert.doesNotThrow(() => assertPublicUrl("http://8.8.8.8/"));
});

test("rejects the IPv6 loopback address", () => {
  assert.throws(() => assertPublicUrl("http://[::1]/"), /private, loopback/);
});

test("rejects IPv6 link-local addresses (fe80::/10)", () => {
  assert.throws(() => assertPublicUrl("http://[fe80::1]/"), /private, loopback/);
});

test("rejects IPv6 unique-local addresses (fc00::/7)", () => {
  assert.throws(() => assertPublicUrl("http://[fc00::1]/"), /private, loopback/);
  assert.throws(() => assertPublicUrl("http://[fd12:3456::1]/"), /private, loopback/);
});

test("rejects the cloud-metadata address via its IPv4-mapped IPv6 encoding, both dotted and hex forms", () => {
  assert.throws(
    () => assertPublicUrl("http://[::ffff:169.254.169.254]/"),
    /private, loopback/,
  );
  assert.throws(() => assertPublicUrl("http://[::ffff:a9fe:a9fe]/"), /private, loopback/);
});

test("allows a real public IPv6 address", () => {
  assert.doesNotThrow(() => assertPublicUrl("http://[2001:4860:4860::8888]/"));
});
