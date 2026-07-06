const express = require("express");
const { ingestEvent } = require("../controllers/event-controller");

const router = express.Router();

router.post("/", ingestEvent);

module.exports = router;
