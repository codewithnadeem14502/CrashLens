const mongoose = require("mongoose");
const { queryDefinitionSchema } = require("./query-definition-schema");
const {
  ThresholdType,
  ThresholdDirection,
  AlertState,
  RuleStatus,
  NotificationActionType,
} = require("../utils/constants");

const MAX_NOTIFICATION_ACTIONS = 10;

const notificationActionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.values(NotificationActionType), required: true },
    // Email address or webhook URL depending on type - validated at the
    // Joi layer (validators/alert-rule-validator.js), including the SSRF
    // guard for webhook targets. Not re-validated by shape here since a
    // single "target" string covers both without a discriminated subschema.
    target: { type: String, required: true, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const alertRuleSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    projectId: { type: mongoose.Schema.Types.ObjectId, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    status: {
      type: String,
      enum: Object.values(RuleStatus),
      default: RuleStatus.ACTIVE,
    },
    query: { type: queryDefinitionSchema, required: true },
    thresholdType: {
      type: String,
      enum: Object.values(ThresholdType),
      required: true,
    },
    direction: {
      type: String,
      enum: Object.values(ThresholdDirection),
      required: true,
    },
    // At least one of warning/critical is required (enforced in
    // validators/alert-rule-validator.js, a cross-field rule that belongs
    // at the API layer, not as a mongoose-level constraint).
    warningThreshold: { type: Number, default: null },
    criticalThreshold: { type: Number, default: null },
    // The hysteresis boundary: distinct from warning/criticalThreshold so a
    // value oscillating right at the trigger point doesn't flap the alert
    // open/closed every evaluation tick. See jobs/alert-evaluator.js.
    resolveThreshold: { type: Number, required: true },
    evaluationIntervalSeconds: { type: Number, default: 60, min: 30, max: 3600 },
    notificationActions: {
      type: [notificationActionSchema],
      default: [],
      validate: {
        validator: (actions) => actions.length <= MAX_NOTIFICATION_ACTIONS,
        message: `A rule cannot have more than ${MAX_NOTIFICATION_ACTIONS} notification actions`,
      },
    },
    state: {
      type: String,
      enum: Object.values(AlertState),
      default: AlertState.OK,
    },
    lastValue: { type: Number, default: null },
    lastEvaluatedAt: { type: Date, default: null },
    lastTriggeredAt: { type: Date, default: null },
    // Precomputed "next due" timestamp, sargable via the compound index
    // below - same pattern as monitor-service's Monitor.nextExpectedAt /
    // UptimeMonitor.nextProbeAt (a $expr-based "is it due" comparison can't
    // use a btree index; this field can).
    nextEvaluationAt: { type: Date, default: Date.now, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

alertRuleSchema.index({ status: 1, nextEvaluationAt: 1 });
alertRuleSchema.index({ organizationId: 1, createdAt: -1 });

const AlertRule = mongoose.model("AlertRule", alertRuleSchema);

module.exports = { AlertRule, MAX_NOTIFICATION_ACTIONS };
