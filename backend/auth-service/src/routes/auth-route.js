const express = require("express");
const authController = require("../controllers/auth-controller");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const validateRequest = require("../middleware/validateRequest");
const authValidation = require("../validators/auth-validator");
const { Permissions } = require("../utils/constants");

const router = express.Router();

router.get(
  "/organizations/:organizationId",
  validateRequest(authValidation.getOrganization),
  authenticate,
  requirePermission(Permissions.ORGANIZATION_VIEW),
  authController.getOrganization,
);

router.get(
  "/organizations/:organizationId/members",
  validateRequest(authValidation.getOrganizationMembers),
  authenticate,
  requirePermission(Permissions.MEMBER_VIEW),
  authController.getOrganizationMembers,
);

router.post(
  "/organizations",
  validateRequest(authValidation.createOrganizationWithAdmin),
  authController.createOrganizationWithAdmin,
);

router.post(
  "/organizations/:organizationId/members",
  validateRequest(authValidation.createOrganizationMember),
  authenticate,
  requirePermission(Permissions.MEMBER_INVITE),
  authController.createOrganizationMember,
);

router.patch(
  "/organizations/:organizationId/members/:memberId/role",
  validateRequest(authValidation.updateOrganizationMemberRole),
  authenticate,
  requirePermission(Permissions.MEMBER_ROLE_UPDATE),
  authController.updateOrganizationMemberRole,
);

router.delete(
  "/organizations/:organizationId/members/:memberId",
  validateRequest(authValidation.deleteOrganizationMember),
  authenticate,
  requirePermission(Permissions.MEMBER_REMOVE),
  authController.deleteOrganizationMember,
);

router.post(
  "/login",
  validateRequest(authValidation.login),
  authController.login,
);

router.patch(
  "/me/password",
  validateRequest(authValidation.updatePassword),
  authenticate,
  authController.updatePassword,
);

router.post(
  "/refresh-token",
  validateRequest(authValidation.refreshTokenPayload),
  authController.refreshAccessToken,
);

router.post(
  "/logout",
  validateRequest(authValidation.refreshTokenPayload),
  authController.revokeRefreshToken,
);

module.exports = router;
