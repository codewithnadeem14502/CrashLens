const mongoose = require("mongoose");
const { ApiError } = require("./constants");

const parseDsn = (dsn) => {
  if (!dsn || typeof dsn !== "string") {
    throw new ApiError(400, "dsn is required");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(dsn);
  } catch (error) {
    throw new ApiError(400, "dsn is invalid");
  }

  const protocol = parsedUrl.protocol.replace(":", "");
  const dsnPublicKey = parsedUrl.username;
  const host = parsedUrl.host;
  const projectId = parsedUrl.pathname.replace(/^\/+/, "");

  if (protocol !== "crashlens") {
    throw new ApiError(400, "dsn protocol must be crashlens");
  }

  if (!dsnPublicKey) {
    throw new ApiError(400, "dsn public key is required");
  }

  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "dsn projectId is invalid");
  }

  return {
    protocol,
    dsnPublicKey,
    host,
    projectId,
  };
};

module.exports = {
  parseDsn,
};
