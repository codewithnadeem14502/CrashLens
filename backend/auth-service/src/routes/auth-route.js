const express = require("express");
const authController = require("../controllers/auth-controller");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const { Permissions } = require("../utils/constants");

const router = express.Router();

router.get(
  "/organizations/:organizationId",
  authenticate,
  requirePermission(Permissions.ORGANIZATION_VIEW),
  authController.getOrganization,
);

router.get(
  "/organizations/:organizationId/members",
  authenticate,
  requirePermission(Permissions.MEMBER_VIEW),
  authController.getOrganizationMembers,
);

router.post("/organizations", authController.createOrganizationWithAdmin);

router.post(
  "/organizations/:organizationId/members",
  authenticate,
  requirePermission(Permissions.MEMBER_INVITE),
  authController.createOrganizationMember,
);

router.patch(
  "/organizations/:organizationId/members/:memberId/role",
  authenticate,
  requirePermission(Permissions.MEMBER_ROLE_UPDATE),
  authController.updateOrganizationMemberRole,
);

router.delete(
  "/organizations/:organizationId/members/:memberId",
  authenticate,
  requirePermission(Permissions.MEMBER_REMOVE),
  authController.deleteOrganizationMember,
);

router.post("/login", authController.login);

router.post("/refresh-token", authController.refreshAccessToken);

router.post("/logout", authController.revokeRefreshToken);

module.exports = router;
