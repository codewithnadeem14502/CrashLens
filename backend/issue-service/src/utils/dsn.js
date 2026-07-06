const crypto = require("crypto");

const generateDsnPublicKey = () => crypto.randomBytes(24).toString("hex");

const getDsnHost = () => process.env.PUBLIC_DSN_HOST || "localhost:3003";

const buildDsn = ({ publicKey, projectId }) => {
  const protocol = process.env.DSN_PROTOCOL || "crashlens";

  return `${protocol}://${publicKey}@${getDsnHost()}/${projectId}`;
};

module.exports = {
  buildDsn,
  generateDsnPublicKey,
};
