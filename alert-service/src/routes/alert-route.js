const express = require("express");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const validateRequest = require("../middleware/validateRequest");
const { Permissions } = require("../utils/constants");
const {
  createAlertRule,
  listAlertRules,
  getAlertRule,
  updateAlertRule,
  deleteAlertRule,
  listAlertEvents,
} = require("../controllers/alert-rule-controller");
const {
  createAlertRuleSchema,
  updateAlertRuleSchema,
  ruleIdParamSchema,
  listAlertRulesSchema,
  listAlertEventsSchema,
} = require("../validators/alert-rule-validator");

const router = express.Router();

router.use(authenticate);

router.post(
  "/rules",
  validateRequest(createAlertRuleSchema),
  requirePermission(Permissions.ALERT_MANAGE),
  createAlertRule,
);
router.get(
  "/rules",
  validateRequest(listAlertRulesSchema),
  requirePermission(Permissions.ALERT_VIEW),
  listAlertRules,
);
router.get(
  "/rules/:ruleId",
  validateRequest(ruleIdParamSchema),
  requirePermission(Permissions.ALERT_VIEW),
  getAlertRule,
);
router.patch(
  "/rules/:ruleId",
  validateRequest(updateAlertRuleSchema),
  requirePermission(Permissions.ALERT_MANAGE),
  updateAlertRule,
);
router.delete(
  "/rules/:ruleId",
  validateRequest(ruleIdParamSchema),
  requirePermission(Permissions.ALERT_MANAGE),
  deleteAlertRule,
);
router.get(
  "/rules/:ruleId/events",
  validateRequest(listAlertEventsSchema),
  requirePermission(Permissions.ALERT_VIEW),
  listAlertEvents,
);

module.exports = router;
