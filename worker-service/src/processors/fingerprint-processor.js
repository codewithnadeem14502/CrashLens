const crypto = require("crypto");

const FINGERPRINT_VERSION = "v1";

const generateFingerprint = ({
  projectId,
  environment,
  event,
  normalizedMessage,
  culprit,
}) => {
  const fingerprintSource = [
    projectId,
    environment,
    event.type,
    event.errorName || "message",
    normalizedMessage,
    culprit || "no-stack",
  ].join("|");

  return {
    fingerprint: crypto
      .createHash("sha256")
      .update(fingerprintSource)
      .digest("hex"),
    fingerprintSource,
    fingerprintVersion: FINGERPRINT_VERSION,
  };
};

module.exports = {
  generateFingerprint,
};
