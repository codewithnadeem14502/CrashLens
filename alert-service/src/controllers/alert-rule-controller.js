const { AlertRule } = require("../models/alert-rule-model");
const { AlertEvent } = require("../models/alert-event-model");
const { ApiError, asyncHandler } = require("../utils/constants");

const parsePagination = (query) => {
  const page = query.page || 1;
  const limit = query.limit || 20;
  return { page, limit, skip: (page - 1) * limit };
};

const sanitizeRule = (rule) => ({
  id: rule._id,
  organizationId: rule.organizationId,
  projectId: rule.projectId,
  name: rule.name,
  status: rule.status,
  query: rule.query,
  thresholdType: rule.thresholdType,
  direction: rule.direction,
  warningThreshold: rule.warningThreshold,
  criticalThreshold: rule.criticalThreshold,
  resolveThreshold: rule.resolveThreshold,
  evaluationIntervalSeconds: rule.evaluationIntervalSeconds,
  notificationActions: rule.notificationActions,
  state: rule.state,
  lastValue: rule.lastValue,
  lastEvaluatedAt: rule.lastEvaluatedAt,
  lastTriggeredAt: rule.lastTriggeredAt,
  nextEvaluationAt: rule.nextEvaluationAt,
  createdAt: rule.createdAt,
  updatedAt: rule.updatedAt,
});

const findRuleForRequest = async ({ ruleId, organizationId }) => {
  const rule = await AlertRule.findOne({ _id: ruleId, organizationId });

  if (!rule) {
    throw new ApiError(404, "Alert rule not found");
  }

  return rule;
};

const createAlertRule = asyncHandler(async (req, res) => {
  const rule = await AlertRule.create({
    organizationId: req.user.organizationId,
    projectId: req.body.projectId,
    name: req.body.name,
    status: req.body.status,
    query: req.body.query,
    thresholdType: req.body.thresholdType,
    direction: req.body.direction,
    warningThreshold: req.body.warningThreshold,
    criticalThreshold: req.body.criticalThreshold,
    resolveThreshold: req.body.resolveThreshold,
    evaluationIntervalSeconds: req.body.evaluationIntervalSeconds,
    notificationActions: req.body.notificationActions,
    createdBy: req.user.sub,
  });

  return res.status(201).json({ success: true, data: { rule: sanitizeRule(rule) } });
});

const listAlertRules = asyncHandler(async (req, res) => {
  const filter = { organizationId: req.user.organizationId };

  if (req.query.projectId) {
    filter.projectId = req.query.projectId;
  }

  if (req.query.status) {
    filter.status = req.query.status;
  }

  const { page, limit, skip } = parsePagination(req.query);

  const [rules, total] = await Promise.all([
    AlertRule.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    AlertRule.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      rules: rules.map(sanitizeRule),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

const getAlertRule = asyncHandler(async (req, res) => {
  const rule = await findRuleForRequest({
    ruleId: req.params.ruleId,
    organizationId: req.user.organizationId,
  });

  return res.status(200).json({ success: true, data: { rule: sanitizeRule(rule) } });
});

const UPDATABLE_FIELDS = [
  "name",
  "projectId",
  "status",
  "query",
  "thresholdType",
  "direction",
  "warningThreshold",
  "criticalThreshold",
  "resolveThreshold",
  "evaluationIntervalSeconds",
  "notificationActions",
];

const updateAlertRule = asyncHandler(async (req, res) => {
  const rule = await findRuleForRequest({
    ruleId: req.params.ruleId,
    organizationId: req.user.organizationId,
  });

  UPDATABLE_FIELDS.forEach((field) => {
    if (req.body[field] !== undefined) {
      rule[field] = req.body[field];
    }
  });

  // Any change re-arms evaluation immediately rather than waiting out
  // whatever was left of the previous interval.
  rule.nextEvaluationAt = new Date();

  await rule.save();

  return res.status(200).json({ success: true, data: { rule: sanitizeRule(rule) } });
});

const deleteAlertRule = asyncHandler(async (req, res) => {
  const rule = await findRuleForRequest({
    ruleId: req.params.ruleId,
    organizationId: req.user.organizationId,
  });

  await rule.deleteOne();
  await AlertEvent.deleteMany({ ruleId: rule._id });

  return res.status(200).json({ success: true, message: "Alert rule deleted" });
});

const listAlertEvents = asyncHandler(async (req, res) => {
  const rule = await findRuleForRequest({
    ruleId: req.params.ruleId,
    organizationId: req.user.organizationId,
  });

  const { page, limit, skip } = parsePagination(req.query);

  const [events, total] = await Promise.all([
    AlertEvent.find({ ruleId: rule._id }).sort({ triggeredAt: -1 }).skip(skip).limit(limit),
    AlertEvent.countDocuments({ ruleId: rule._id }),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      events,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

module.exports = {
  createAlertRule,
  listAlertRules,
  getAlertRule,
  updateAlertRule,
  deleteAlertRule,
  listAlertEvents,
};
