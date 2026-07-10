const express = require("express");
const projectController = require("../controllers/project-controller");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const requireRole = require("../middleware/requireRole");
const { Permissions, Roles } = require("../utils/constants");

const router = express.Router();

router.use(authenticate);

router.post(
  "/",
  requirePermission(Permissions.PROJECT_CREATE),
  projectController.createProject,
);

router.get(
  "/",
  requirePermission(Permissions.PROJECT_VIEW),
  projectController.listProjects,
);

router.get(
  "/:projectId",
  requirePermission(Permissions.PROJECT_VIEW),
  projectController.getProject,
);

router.patch(
  "/:projectId",
  requirePermission(Permissions.PROJECT_UPDATE),
  projectController.updateProject,
);

router.delete(
  "/:projectId",
  requirePermission(Permissions.PROJECT_DELETE),
  projectController.archiveProject,
);

router.get(
  "/:projectId/dsn",
  requirePermission(Permissions.PROJECT_VIEW),
  requireRole(Roles.ADMIN, Roles.DEVELOPER),
  projectController.getProjectDsn,
);

router.post(
  "/:projectId/regenerate-dsn",
  requirePermission(Permissions.PROJECT_UPDATE),
  projectController.regenerateProjectDsn,
);

module.exports = router;
