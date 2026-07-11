const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { buildCorsOptions } = require("./utils/cors");
const eventRoutes = require("./routes/event-route");
const { redactSensitiveFields } = require("./utils/constants");

const app = express();

app.set("trust proxy", 1);

//middleware
app.use(helmet());
app.use(cors(buildCorsOptions()));
// Explicit limit (was Express's default 100kb). Sized to the model's own
// stated worst case, not the 256kb worker-service/issue-service convention:
// a transaction can have up to 200 spans (transactionPayloadSchema's Joi
// cap), each allowed up to 2048 bytes of `data` at the Mongoose layer
// (issue-model.js's MAX_SPAN_DATA_BYTES) plus op/description/status/
// spanId/parentSpanId maxlengths and JSON structural overhead - that alone
// is ~750KB before transaction-level fields. 256kb would silently 413 a
// transaction that's fully valid against every individual field cap, at
// well under half the spans the schema claims to allow. 1mb leaves
// comfortable headroom over that ~750KB worst case (a log batch's own worst
// case is far smaller, ~317KB - see MAX_LOGS_PER_BATCH in utils/validation.js).
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  logger.info(`Received ${req.method} request to ${req.url}`);
  logger.info(
    `Request body: ${JSON.stringify(redactSensitiveFields(req.body))}`,
  );
  next();
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "event-service",
    status: "ok",
  });
});

// routes
app.use("/api/events", eventRoutes);

app.use(errorHandler);

module.exports = app;
