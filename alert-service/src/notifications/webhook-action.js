const { assertPublicUrl } = require("../utils/ssrfGuard");
const logger = require("../utils/logger");

const WEBHOOK_TIMEOUT_MS = Number.parseInt(process.env.WEBHOOK_TIMEOUT_MS || "8000", 10);

// Generic incoming-webhook POST - deliberately unopinionated about the
// receiving system's payload shape (Slack/PagerDuty/etc. incoming webhooks
// all accept a plain JSON POST; anything more specific than that is a
// per-integration concern out of this module's scope).
const sendWebhook = async ({ url, payload }) => {
  assertPublicUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Webhook responded with status ${response.status}`);
    }

    logger.info(`Delivered webhook notification to ${url}`);
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = { sendWebhook };
