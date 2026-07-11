const emailAction = require("./email-action");
const webhookAction = require("./webhook-action");
const { NotificationActionType, NotificationDeliveryStatus } = require("../utils/constants");
const logger = require("../utils/logger");

// Called through the module object (emailAction.sendEmail / .sendWebhook),
// not destructured, so node:test's mock.method(emailAction, "sendEmail",
// fn) can substitute mocked delivery for tests without a real SMTP/HTTP
// endpoint - a destructured import would keep pointing at the original
// function after the mock patches the exports object.
const dispatchOne = async (action, context) => {
  try {
    if (action.type === NotificationActionType.EMAIL) {
      await emailAction.sendEmail({
        to: action.target,
        subject: `[CrashLens] ${context.ruleName}: ${context.toState.toUpperCase()}`,
        text: buildMessage(context),
      });
    } else if (action.type === NotificationActionType.WEBHOOK) {
      await webhookAction.sendWebhook({
        url: action.target,
        payload: {
          ruleId: context.ruleId,
          ruleName: context.ruleName,
          fromState: context.fromState,
          toState: context.toState,
          value: context.value,
          triggeredAt: context.triggeredAt,
        },
      });
    } else {
      throw new Error(`Unknown notification action type "${action.type}"`);
    }

    return { type: action.type, target: action.target, status: NotificationDeliveryStatus.SENT, error: null };
  } catch (error) {
    logger.warn(
      `Notification delivery failed (${action.type} -> ${action.target}): ${error.message}`,
    );
    return {
      type: action.type,
      target: action.target,
      status: NotificationDeliveryStatus.FAILED,
      error: error.message,
    };
  }
};

const buildMessage = (context) =>
  `Alert "${context.ruleName}" moved from ${context.fromState} to ${context.toState} ` +
  `(value: ${context.value}) at ${context.triggeredAt.toISOString()}.`;

// One failing action must not block the others - Promise.allSettled would
// be redundant here since dispatchOne already catches internally and never
// rejects, but Promise.all still runs every action concurrently rather
// than serially.
const dispatchNotifications = async (actions, context) =>
  Promise.all(actions.map((action) => dispatchOne(action, context)));

module.exports = { dispatchNotifications };
