const parseAllowedOrigins = () =>
  (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const buildCorsOptions = () => {
  const allowedOrigins = parseAllowedOrigins();
  const allowCredentials = process.env.CORS_CREDENTIALS === "true";

  return {
    credentials: allowCredentials,
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
  };
};

module.exports = {
  buildCorsOptions,
};
