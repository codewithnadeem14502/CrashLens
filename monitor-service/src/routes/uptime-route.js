const express = require("express");
const uptimeController = require("../controllers/uptime-controller");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const validateRequest = require("../middleware/validateRequest");
const uptimeValidation = require("../validators/uptime-validator");
const { Permissions } = require("../utils/constants");

const router = express.Router();

// Unlike Monitor, UptimeMonitor has no external-ping surface at all - the
// prober is entirely active (monitor-service itself makes the HTTP calls,
// see jobs/uptime-prober.js), so every route here is dashboard-only and can
// sit behind a single router-wide authenticate.
router.use(authenticate);

router.post(
  "/",
  validateRequest(uptimeValidation.createUptimeMonitor),
  requirePermission(Permissions.MONITOR_MANAGE),
  uptimeController.createUptimeMonitor,
);

router.get(
  "/",
  validateRequest(uptimeValidation.listUptimeMonitors),
  requirePermission(Permissions.MONITOR_VIEW),
  uptimeController.listUptimeMonitors,
);

router.get(
  "/:uptimeMonitorId",
  validateRequest(uptimeValidation.getUptimeMonitor),
  requirePermission(Permissions.MONITOR_VIEW),
  uptimeController.getUptimeMonitor,
);

router.patch(
  "/:uptimeMonitorId",
  validateRequest(uptimeValidation.updateUptimeMonitor),
  requirePermission(Permissions.MONITOR_MANAGE),
  uptimeController.updateUptimeMonitor,
);

router.delete(
  "/:uptimeMonitorId",
  validateRequest(uptimeValidation.deleteUptimeMonitor),
  requirePermission(Permissions.MONITOR_MANAGE),
  uptimeController.deleteUptimeMonitor,
);

router.get(
  "/:uptimeMonitorId/checks",
  validateRequest(uptimeValidation.listChecks),
  requirePermission(Permissions.MONITOR_VIEW),
  uptimeController.listChecks,
);

module.exports = router;
