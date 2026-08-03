const crypto = require("crypto");

const generateDsnPublicKey = () => crypto.randomBytes(24).toString("hex");

// The host segment of a DSN is where the *client app* sends events, so it
// must be the publicly reachable api-gateway origin - never event-service's
// own port. The old default here was "localhost:3003" (event-service
// direct), which is unreachable from any real app and bypasses the
// gateway's rate limiting even when it does resolve.
//
// PUBLIC_DSN_HOST MUST be set in any deployment that isn't a developer's
// laptop; the fallback is a local-dev convenience only, and matches the
// SDK's own default endpoint (http://localhost:3000/v1/events).
const getDsnHost = () => process.env.PUBLIC_DSN_HOST || "localhost:3000";

const buildDsn = ({ publicKey, projectId }) => {
  const protocol = process.env.DSN_PROTOCOL || "crashlens";

  return `${protocol}://${publicKey}@${getDsnHost()}/${projectId}`;
};

module.exports = {
  buildDsn,
  generateDsnPublicKey,
};
