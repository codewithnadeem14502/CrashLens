const express = require("express");
const logController = require("../controllers/log-controller");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const validateRequest = require("../middleware/validateRequest");
const logValidation = require("../validators/log-validator");
const { Permissions } = require("../utils/constants");

const createLogRouter = () => {
  const router = express.Router();

  router.use(authenticate);

  // Reuses ISSUE_VIEW rather than introducing a new LOG_VIEW permission -
  // logs are part of the same read-only observability surface issues and
  // performance already share that permission for, and adding a new
  // permission would require an auth-service RBAC change (RolePermissions
  // map, JWT claim shape) that's out of this module's scope. Revisit if a
  // future module needs logs to have an independently grantable permission.
  router.get(
    "/",
    validateRequest(logValidation.listLogs),
    requirePermission(Permissions.ISSUE_VIEW),
    logController.listLogs,
  );

  return router;
};

module.exports = createLogRouter;
