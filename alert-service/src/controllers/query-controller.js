const { executeQuery, executeQueryWithChange } = require("../query/query-executor");
const { asyncHandler, ThresholdType } = require("../utils/constants");

// The one execution surface for the generic query executor - used by the
// widget builder and the alert rule builder to preview a live value before
// saving, and reusable ad hoc without persisting anything.
const executeQueryPreview = asyncHandler(async (req, res) => {
  const { query, thresholdType } = req.body;

  const result =
    thresholdType === ThresholdType.PERCENT_CHANGE
      ? await executeQueryWithChange(query, req.user.organizationId)
      : await executeQuery(query, req.user.organizationId);

  return res.status(200).json({ success: true, data: result });
});

module.exports = { executeQueryPreview };
