require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { buildCorsOptions } = require("./utils/cors");
const eventRoutes = require("./routes/event-route");
const connectDatabase = require("./config/database");
const { redactSensitiveFields } = require("./utils/constants");
const { closeRabbitMQ, connectToRabbitMQ } = require("./utils/rabbitmq");
const { startProjectEventConsumer } = require("./events/project-event-consumer");

const app = express();
const PORT = process.env.PORT || 3003;

app.set("trust proxy", 1);

//middleware
app.use(helmet());
app.use(cors(buildCorsOptions()));
app.use(express.json());

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

async function startServer() {
  try {
    await connectDatabase();
    await connectToRabbitMQ();
    await startProjectEventConsumer();
    app.listen(PORT, () => {
      logger.info(`event service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("Failed to connect to server", error);
    process.exit(1);
  }
}

startServer();

//unhandled promise rejection
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at", promise, "reason:", reason);
});

process.on("SIGTERM", async () => {
  await closeRabbitMQ();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await closeRabbitMQ();
  process.exit(0);
});
