const express = require("express");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const validateRequest = require("../middleware/validateRequest");
const { Permissions } = require("../utils/constants");
const { executeQueryPreview } = require("../controllers/query-controller");
const { executeQuerySchema } = require("../validators/dashboard-validator");

const router = express.Router();

router.use(authenticate);

router.post(
  "/execute",
  validateRequest(executeQuerySchema),
  requirePermission(Permissions.ALERT_VIEW),
  executeQueryPreview,
);

module.exports = router;
