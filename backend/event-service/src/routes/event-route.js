const express = require("express");
const {
  ingestEvent,
  ingestTransaction,
} = require("../controllers/event-controller");

const router = express.Router();

router.post("/", ingestEvent);
router.post("/transactions", ingestTransaction);

module.exports = router;
