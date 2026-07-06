const { EventKinds, Severity } = require("../utils/constants");

const CRITICAL_PATTERN = /outofmemory|fatal|unhandledpromiserejection|crash/i;
const HIGH_PATTERN = /database|mongo|network|auth|payment|timeout|connection/i;

const calculateSeverity = ({ event, normalizedMessage }) => {
  const errorName = event.errorName || "";
  const message = normalizedMessage || event.message || "";
  const combined = `${errorName} ${message}`;

  if (CRITICAL_PATTERN.test(combined)) {
    return Severity.CRITICAL;
  }

  if (event.type === EventKinds.EXCEPTION && event.stack) {
    return Severity.HIGH;
  }

  if (HIGH_PATTERN.test(combined)) {
    return Severity.HIGH;
  }

  if (event.type === EventKinds.EXCEPTION) {
    return Severity.MEDIUM;
  }

  return Severity.LOW;
};

module.exports = {
  calculateSeverity,
};
