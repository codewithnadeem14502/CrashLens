const express = require("express");
const {
  ingestEvent,
  ingestTransaction,
  ingestLogs,
} = require("../controllers/event-controller");

const router = express.Router();

router.post("/", ingestEvent);
router.post("/transactions", ingestTransaction);
router.post("/logs", ingestLogs);

module.exports = router;
