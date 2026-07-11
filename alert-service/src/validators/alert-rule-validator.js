const Joi = require("joi");
const { queryDefinitionSchema } = require("./query-validator");
const { assertPublicUrl } = require("../utils/ssrfGuard");
const {
  ThresholdType,
  ThresholdDirection,
  RuleStatus,
  NotificationActionType,
} = require("../utils/constants");
const { MAX_NOTIFICATION_ACTIONS } = require("../models/alert-rule-model");

const objectIdSchema = Joi.string().hex().length(24);

const notificationActionSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(NotificationActionType))
    .required(),
  target: Joi.string().max(500).required(),
}).custom((value, helpers) => {
  if (value.type === NotificationActionType.EMAIL) {
    if (Joi.string().email().validate(value.target).error) {
      return helpers.message("target must be a valid email address");
    }
  } else if (value.type === NotificationActionType.WEBHOOK) {
    try {
      assertPublicUrl(value.target);
    } catch (error) {
      return helpers.message(error.message);
    }
  }

  return value;
}, "notification action target shape");

// Shared by create and update: at least one of warning/critical must be
// set, and resolveThreshold has to sit on the "safe" side of whichever
// escalation thresholds are configured (direction-aware) so there's a real
// hysteresis band rather than resolveThreshold === warningThreshold
// re-firing/re-resolving on every tick a value sits exactly on the line.
const validateThresholdShape = (value, helpers) => {
  const { direction, warningThreshold, criticalThreshold, resolveThreshold } = value;

  if (warningThreshold == null && criticalThreshold == null) {
    return helpers.message("at least one of warningThreshold or criticalThreshold is required");
  }

  if (
    warningThreshold != null &&
    criticalThreshold != null &&
    ((direction === ThresholdDirection.ABOVE && criticalThreshold < warningThreshold) ||
      (direction === ThresholdDirection.BELOW && criticalThreshold > warningThreshold))
  ) {
    return helpers.message(
      "criticalThreshold must be at least as severe as warningThreshold for the configured direction",
    );
  }

  const leastSevere = warningThreshold ?? criticalThreshold;
  const resolvesCleanly =
    direction === ThresholdDirection.ABOVE
      ? resolveThreshold < leastSevere
      : resolveThreshold > leastSevere;

  if (!resolvesCleanly) {
    return helpers.message(
      direction === ThresholdDirection.ABOVE
        ? "resolveThreshold must be less than warningThreshold (or criticalThreshold, if warning is unset)"
        : "resolveThreshold must be greater than warningThreshold (or criticalThreshold, if warning is unset)",
    );
  }

  return value;
};

const baseRuleFields = {
  name: Joi.string().max(120).required(),
  projectId: objectIdSchema,
  status: Joi.string().valid(...Object.values(RuleStatus)),
  query: queryDefinitionSchema.required(),
  thresholdType: Joi.string()
    .valid(...Object.values(ThresholdType))
    .required(),
  direction: Joi.string()
    .valid(...Object.values(ThresholdDirection))
    .required(),
  warningThreshold: Joi.number().allow(null),
  criticalThreshold: Joi.number().allow(null),
  resolveThreshold: Joi.number().required(),
  evaluationIntervalSeconds: Joi.number().integer().min(30).max(3600).default(60),
  notificationActions: Joi.array().items(notificationActionSchema).max(MAX_NOTIFICATION_ACTIONS).default([]),
};

const createAlertRuleSchema = {
  body: Joi.object(baseRuleFields).custom(validateThresholdShape, "threshold shape"),
};

const updateAlertRuleSchema = {
  params: Joi.object({ ruleId: objectIdSchema.required() }),
  body: Joi.object({
    name: Joi.string().max(120),
    projectId: objectIdSchema.allow(null),
    status: Joi.string().valid(...Object.values(RuleStatus)),
    query: queryDefinitionSchema,
    thresholdType: Joi.string().valid(...Object.values(ThresholdType)),
    direction: Joi.string().valid(...Object.values(ThresholdDirection)),
    warningThreshold: Joi.number().allow(null),
    criticalThreshold: Joi.number().allow(null),
    resolveThreshold: Joi.number(),
    evaluationIntervalSeconds: Joi.number().integer().min(30).max(3600),
    notificationActions: Joi.array().items(notificationActionSchema).max(MAX_NOTIFICATION_ACTIONS),
  })
    .min(1)
    .custom((value, helpers) => {
      // Cross-field threshold validation only applies when the update
      // actually touches the threshold shape - a status-only pause/resume
      // PATCH shouldn't have to resend a fully valid threshold set.
      const touchesThresholds =
        "direction" in value ||
        "warningThreshold" in value ||
        "criticalThreshold" in value ||
        "resolveThreshold" in value;

      if (!touchesThresholds) {
        return value;
      }

      if (!("direction" in value) || !("resolveThreshold" in value)) {
        return helpers.message("direction and resolveThreshold must be included together with any threshold change");
      }

      return validateThresholdShape(value, helpers);
    }, "threshold shape (update)"),
};

const ruleIdParamSchema = {
  params: Joi.object({ ruleId: objectIdSchema.required() }),
};

const listAlertRulesSchema = {
  query: Joi.object({
    projectId: objectIdSchema,
    status: Joi.string().valid(...Object.values(RuleStatus)),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const listAlertEventsSchema = {
  params: Joi.object({ ruleId: objectIdSchema.required() }),
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

module.exports = {
  createAlertRuleSchema,
  updateAlertRuleSchema,
  ruleIdParamSchema,
  listAlertRulesSchema,
  listAlertEventsSchema,
};
