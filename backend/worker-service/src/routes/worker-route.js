const express = require("express");

const router = express.Router();

router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "worker-service",
    status: "ok",
  });
});

module.exports = router;
