const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

let cachedTransport = null;

// Lazily built so tests that never send a real email (mocked delivery)
// never need real SMTP env vars configured.
const getTransport = () => {
  if (cachedTransport) {
    return cachedTransport;
  }

  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  return cachedTransport;
};

const sendEmail = async ({ to, subject, text }) => {
  if (!process.env.SMTP_HOST) {
    throw new Error("SMTP_HOST is not configured");
  }

  const transport = getTransport();

  await transport.sendMail({
    from: process.env.SMTP_FROM || "alerts@crashlens.local",
    to,
    subject,
    text,
  });

  logger.info(`Sent alert email to ${to}`);
};

module.exports = { sendEmail };
