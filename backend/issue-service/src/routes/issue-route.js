const express = require("express");
const issueController = require("../controllers/issue-controller");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const { Permissions } = require("../utils/constants");

const createIssueRouter = ({ sensitiveLimiter } = {}) => {
  const router = express.Router();
  const limiter = sensitiveLimiter || ((req, res, next) => next());

  router.use(authenticate);

  router.get(
    "/",
    requirePermission(Permissions.ISSUE_VIEW),
    issueController.listIssues,
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
    limiter,
    requirePermission(Permissions.ISSUE_UPDATE),
    issueController.updateIssueStatus,
  );

  return router;
};

module.exports = createIssueRouter;
