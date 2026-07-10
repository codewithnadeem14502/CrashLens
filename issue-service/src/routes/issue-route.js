const express = require("express");
const issueController = require("../controllers/issue-controller");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const { Permissions } = require("../utils/constants");

const createIssueRouter = () => {
  const router = express.Router();

  router.use(authenticate);

  router.get(
    "/",
    requirePermission(Permissions.ISSUE_VIEW),
    issueController.listIssues,
  );

  router.get(
    "/performance/endpoints",
    requirePermission(Permissions.ISSUE_VIEW),
    issueController.listPerformanceEndpoints,
  );

  router.get(
    "/performance/endpoints/:endpointId",
    requirePermission(Permissions.ISSUE_VIEW),
    issueController.getEndpointPerformance,
  );

  router.get(
    "/performance/endpoints/:endpointId/trends",
    requirePermission(Permissions.ISSUE_VIEW),
    issueController.getEndpointTrends,
  );

  router.get(
    "/performance/traces/:traceId",
    requirePermission(Permissions.ISSUE_VIEW),
    issueController.getTrace,
  );

  router.get(
    "/:issueId",
    requirePermission(Permissions.ISSUE_VIEW),
    issueController.getIssue,
  );

  router.get(
    "/:issueId/events",
    requirePermission(Permissions.ISSUE_VIEW),
    issueController.listIssueEvents,
  );

  router.patch(
    "/:issueId/status",
    requirePermission(Permissions.ISSUE_UPDATE),
    issueController.updateIssueStatus,
  );

  return router;
};

module.exports = createIssueRouter;
