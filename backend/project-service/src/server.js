require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { buildCorsOptions } = require("./utils/cors");
const projectRoutes = require("./routes/project-route");
const connectDatabase = require("./config/database");
const { redactSensitiveFields } = require("./utils/constants");
const { closeRabbitMQ, connectToRabbitMQ } = require("./utils/rabbitmq");
const { closeRedis } = require("./utils/redis");

const app = express();
const PORT = process.env.PORT || 3002;

app.set("trust proxy", 1);

connectDatabase().catch((e) => logger.error("Mongo connection error", e));

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
    service: "project-service",
    status: "ok",
  });
});

app.use("/api/projects", projectRoutes);

app.use(errorHandler);

async function startServer() {
  try {
    await connectToRabbitMQ();
    app.listen(PORT, () => {
      logger.info(`project service running on port ${PORT}`);
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
  await closeRedis();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await closeRabbitMQ();
  await closeRedis();
  process.exit(0);
});
