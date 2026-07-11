const KNOWN_DEFAULT_JWT_SECRET = "dev-auth-service-secret-change-me";

/**
 * Fail-closed startup guard: throws if JWT_SECRET is unset, empty, or still
 * set to the known placeholder default. Callers must catch this at boot and
 * refuse to start the process (log + process.exit(1)) rather than letting
 * the service run with a forgeable/guessable signing secret.
 *
 * This file must stay byte-identical across auth-service, project-service,
 * issue-service, api-gateway, monitor-service, and alert-service (no shared
 * package exists yet across the 3 repos - consolidation into a shared/ dir
 * is deferred to a later cleanup module).
 */
const assertJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.trim() === "") {
    throw new Error(
      "JWT_SECRET is not set. Refusing to start. Set JWT_SECRET to a strong, unique secret.",
    );
  }

  if (secret === KNOWN_DEFAULT_JWT_SECRET) {
    throw new Error(
      "JWT_SECRET is set to the known default placeholder value. Refusing to start. " +
        "Set JWT_SECRET to a strong, unique secret that is not the default.",
    );
  }
};

module.exports = { assertJwtSecret, KNOWN_DEFAULT_JWT_SECRET };
