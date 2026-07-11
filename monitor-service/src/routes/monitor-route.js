const express = require("express");
const monitorController = require("../controllers/monitor-controller");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const validateRequest = require("../middleware/validateRequest");
const monitorValidation = require("../validators/monitor-validator");
const { Permissions } = require("../utils/constants");

const router = express.Router();

// Check-in ping routes are deliberately NOT behind `authenticate` - they're
// hit by an external cron job holding only the per-monitor checkToken (see
// monitor-controller.js's findMonitorByCheckToken), the same "credential
// instead of a user JWT" design already established for DSN-authenticated
// event ingestion. api-gateway's authenticate.js exempts exactly these two
// routes (POST/PATCH .../checkins*) by method+path, not the sibling GET
// .../checkins history route, which does require a JWT.
router.post(
  "/:monitorId/checkins",
  validateRequest(monitorValidation.createCheckIn),
  monitorController.createCheckIn,
);
router.patch(
  "/:monitorId/checkins/:checkinId",
  validateRequest(monitorValidation.finishCheckIn),
  monitorController.finishCheckIn,
);

router.use(authenticate);

router.post(
  "/",
  validateRequest(monitorValidation.createMonitor),
  requirePermission(Permissions.MONITOR_MANAGE),
  monitorController.createMonitor,
);

router.get(
  "/",
  validateRequest(monitorValidation.listMonitors),
  requirePermission(Permissions.MONITOR_VIEW),
  monitorController.listMonitors,
);

router.get(
  "/:monitorId",
  validateRequest(monitorValidation.getMonitor),
  requirePermission(Permissions.MONITOR_VIEW),
  monitorController.getMonitor,
);

router.patch(
  "/:monitorId",
  validateRequest(monitorValidation.updateMonitor),
  requirePermission(Permissions.MONITOR_MANAGE),
  monitorController.updateMonitor,
);

router.delete(
  "/:monitorId",
  validateRequest(monitorValidation.deleteMonitor),
  requirePermission(Permissions.MONITOR_MANAGE),
  monitorController.deleteMonitor,
);

router.post(
  "/:monitorId/regenerate-token",
  validateRequest(monitorValidation.regenerateToken),
  requirePermission(Permissions.MONITOR_MANAGE),
  monitorController.regenerateCheckToken,
);

router.get(
  "/:monitorId/checkins",
  validateRequest(monitorValidation.listCheckIns),
  requirePermission(Permissions.MONITOR_VIEW),
  monitorController.listCheckIns,
);

module.exports = router;
