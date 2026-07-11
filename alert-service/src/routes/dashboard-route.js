const express = require("express");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const validateRequest = require("../middleware/validateRequest");
const { Permissions } = require("../utils/constants");
const {
  createDashboard,
  listDashboards,
  getDashboard,
  updateDashboard,
  deleteDashboard,
} = require("../controllers/dashboard-controller");
const {
  createDashboardSchema,
  updateDashboardSchema,
  dashboardIdParamSchema,
  listDashboardsSchema,
} = require("../validators/dashboard-validator");

const router = express.Router();

router.use(authenticate);

router.post(
  "/",
  validateRequest(createDashboardSchema),
  requirePermission(Permissions.ALERT_MANAGE),
  createDashboard,
);
router.get("/", validateRequest(listDashboardsSchema), requirePermission(Permissions.ALERT_VIEW), listDashboards);
router.get(
  "/:dashboardId",
  validateRequest(dashboardIdParamSchema),
  requirePermission(Permissions.ALERT_VIEW),
  getDashboard,
);
router.patch(
  "/:dashboardId",
  validateRequest(updateDashboardSchema),
  requirePermission(Permissions.ALERT_MANAGE),
  updateDashboard,
);
router.delete(
  "/:dashboardId",
  validateRequest(dashboardIdParamSchema),
  requirePermission(Permissions.ALERT_MANAGE),
  deleteDashboard,
);

module.exports = router;
