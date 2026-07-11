const { ApiError } = require("./constants");

// Copied verbatim from monitor-service/src/utils/ssrfGuard.js (flagged in
// .claude/rules/real-architecture-reference.md's "Outbound SSRF surface"
// section as the intended reuse point for webhook delivery) - alert-service
// is the second outbound-HTTP-to-a-user-configured-target surface in this
// codebase (generic webhook notification actions), and reuses the exact
// same guard rather than writing a new one. Same accepted gaps apply here
// too: DNS rebinding and redirect-to-internal-target at delivery time are
// not defended against - see the comment below for the full rationale.
//
// Blocks the obvious SSRF targets (loopback, link-local/cloud-metadata,
// RFC1918 private ranges, and their IPv6 equivalents including IPv4-mapped
// IPv6 literals) by literal hostname/IP at rule create/update time.
//
// Deliberately NOT a full SSRF defense - two gaps are known and accepted,
// not addressed here:
//   1. DNS rebinding: a hostname that resolves to a public IP at
//      create-time validation but a private IP at actual delivery-time
//      would bypass this entirely (a complete guard would need to resolve
//      DNS and re-check on every single delivery, not just at create/update).
//   2. Redirects: a delivery to an allowed public URL that 302s to a
//      blocked internal target at request time - native fetch() follows
//      redirects by default and this guard only ever runs once, at
//      create/update.
// Only authenticated ALERT_MANAGE users can set a webhook URL at all, which
// bounds who could attempt this, but that's a weaker guarantee than not
// letting the literal-obvious cases through at all.
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0"]);

const isPrivateIPv4 = (hostname) => {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (!match) {
    return false;
  }

  const [, a, b] = match.map(Number);

  return (
    a === 127 || // loopback
    a === 10 || // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) // 169.254.0.0/16 (link-local, cloud metadata)
  );
};

const stripBrackets = (hostname) => hostname.replace(/^\[|\]$/g, "");

// Converts a single 16-bit hex group (e.g. "a9fe") to its 2-byte dotted
// portion (e.g. "169.254").
const hexGroupToDottedPair = (hexGroup) => {
  const value = Number.parseInt(hexGroup, 16);
  return `${(value >> 8) & 0xff}.${value & 0xff}`;
};

// An IPv4-mapped IPv6 address (::ffff:0:0/96) can be written either with
// the trailing 32 bits as dotted-decimal ("::ffff:169.254.169.254") or as
// two hex groups ("::ffff:a9fe:a9fe") - Node's URL parser normalizes to
// the latter, but both forms are checked since callers may construct a URL
// object differently. Returns the equivalent dotted-decimal IPv4 string,
// or null if this isn't an IPv4-mapped address.
const extractIPv4MappedAddress = (ipv6Hostname) => {
  const match = ipv6Hostname.match(/^::ffff:(.+)$/i);

  if (!match) {
    return null;
  }

  const remainder = match[1];

  if (remainder.includes(".")) {
    return remainder;
  }

  const hexGroups = remainder.split(":");

  if (hexGroups.length === 2) {
    return `${hexGroupToDottedPair(hexGroups[0])}.${hexGroupToDottedPair(hexGroups[1])}`;
  }

  return null;
};

const isBlockedIPv6 = (hostname) => {
  const normalized = stripBrackets(hostname).toLowerCase();

  if (normalized === "::1" || normalized === "::") {
    return true; // loopback / unspecified
  }

  // fe80::/10 (link-local) - the assigned block always starts with one of
  // these four hex digits as the third character.
  if (/^fe[89ab]/.test(normalized)) {
    return true;
  }

  // fc00::/7 (unique-local, the IPv6 analog of RFC1918) - first hex digit
  // "f", second "c" or "d".
  if (/^f[cd]/.test(normalized)) {
    return true;
  }

  const mappedIPv4 = extractIPv4MappedAddress(normalized);
  return mappedIPv4 ? isPrivateIPv4(mappedIPv4) : false;
};

const assertPublicUrl = (rawUrl) => {
  let parsed;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ApiError(400, "url is invalid");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isIPv6Literal = hostname.startsWith("[") || hostname.includes(":");

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    isPrivateIPv4(hostname) ||
    hostname.endsWith(".local") ||
    (isIPv6Literal && isBlockedIPv6(hostname))
  ) {
    throw new ApiError(400, "url must not target a private, loopback, or link-local address");
  }
};

module.exports = { assertPublicUrl };
