const Level = Object.freeze({
  INFO: "info",
  DEBUG: "debug",
});

const NodeEnv = Object.freeze({
  PRODUCTION: "production",
  DEVELOPMENT: "development",
});

// Module 8 security review finding: the gateway's request-logging
// middleware (app.js) logged req.body with NO redaction at all - every
// downstream service redacts before logging, but the gateway sees the
// request FIRST, before any of them. This wasn't just a Module 8 gap
// (login passwords on POST /v1/auth/login were already exposed the same
// way), but Module 8's check-in ping route makes it recur automatically
// and repeatedly (external cron jobs re-POST their checkToken on every
// run), which is what surfaced it. Matches every other service's
// SENSITIVE_KEYS/redactSensitiveFields convention - see
// crasLens-backend/.claude/CLAUDE.md.
const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "accesstoken",
  "refreshtoken",
  "token",
  "checktoken",
  "authorization",
  "cookie",
]);

// Lowercased before the Set lookup (Module 8 security review finding):
// SENSITIVE_KEYS only lists lowercase keys, but real-world header names are
// almost always capitalized ("Authorization", "Cookie") - a case-sensitive
// match would silently let those through. This is the one place in the
// request body most likely to actually contain conventionally-cased header
// names verbatim (an UptimeMonitor's user-supplied `headers` object, proxied
// through here on its way to monitor-service).
const redactSensitiveFields = (value) => {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveFields);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.entries(value).reduce((result, [key, fieldValue]) => {
    result[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? "[REDACTED]"
      : redactSensitiveFields(fieldValue);

    return result;
  }, {});
};

module.exports = { Level, NodeEnv, redactSensitiveFields };
