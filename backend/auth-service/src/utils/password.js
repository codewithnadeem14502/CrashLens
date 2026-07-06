const crypto = require("crypto");
const { promisify } = require("util");

const ITERATIONS = 120000;
const KEY_LENGTH = 64;
const DIGEST = "sha512";
const pbkdf2 = promisify(crypto.pbkdf2);
const randomBytes = promisify(crypto.randomBytes);

const hashPassword = async (password) => {
  const salt = (await randomBytes(16)).toString("hex");
  const hash = (
    await pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST)
  ).toString("hex");

  return `${ITERATIONS}:${salt}:${hash}`;
};

const verifyPassword = async (password, storedHash) => {
  const [iterations, salt, originalHash] = storedHash.split(":");
  const iterationCount = Number(iterations);

  if (
    !Number.isInteger(iterationCount) ||
    iterationCount <= 0 ||
    !salt ||
    !originalHash ||
    originalHash.length !== KEY_LENGTH * 2
  ) {
    return false;
  }

  const hash = (
    await pbkdf2(password, salt, iterationCount, KEY_LENGTH, DIGEST)
  ).toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(originalHash, "hex"),
  );
};

module.exports = {
  hashPassword,
  verifyPassword,
};
