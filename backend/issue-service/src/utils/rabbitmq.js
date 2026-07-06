const amqp = require("amqplib");
const { EventTypes, QueueConfig } = require("./constants");
const logger = require("./logger");

let connection = null;
let channel = null;

const getRetryCount = (msg) => {
  const headerValue = msg?.properties?.headers?.["x-retry-count"];
  const parsed = Number.parseInt(headerValue || "0", 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

async function connectToRabbitMQ() {
  if (channel) {
    return channel;
  }

  connection = await amqp.connect(QueueConfig.RABBITMQ_URL);
  channel = await connection.createConfirmChannel();

  await channel.assertExchange(QueueConfig.EXCHANGE_NAME, "topic", {
    durable: true,
  });

  await channel.assertQueue(QueueConfig.DLQ, { durable: true });

  await channel.assertQueue(QueueConfig.OCCURRENCE_QUEUE, { durable: true });
  await channel.bindQueue(
    QueueConfig.OCCURRENCE_QUEUE,
    QueueConfig.EXCHANGE_NAME,
    EventTypes.ISSUE_OCCURRENCE_DETECTED,
  );

  await channel.assertQueue(QueueConfig.RETRY_QUEUE, {
    durable: true,
    arguments: {
      "x-message-ttl": QueueConfig.RETRY_DELAY_MS,
      "x-dead-letter-exchange": QueueConfig.EXCHANGE_NAME,
      "x-dead-letter-routing-key": EventTypes.ISSUE_OCCURRENCE_DETECTED,
    },
  });

  await channel.prefetch(QueueConfig.PREFETCH);

  connection.on("close", () => {
    logger.warn("RabbitMQ connection closed");
    connection = null;
    channel = null;
  });

  connection.on("error", (error) => {
    logger.error(`RabbitMQ connection error: ${error.message}`);
  });

  logger.info(
    `Connected to RabbitMQ exchange ${QueueConfig.EXCHANGE_NAME}; consuming queue ${QueueConfig.OCCURRENCE_QUEUE}`,
  );

  return channel;
}

async function sendToRetryQueue(message, originalMsg, reason) {
  const activeChannel = channel || (await connectToRabbitMQ());
  const retryCount = getRetryCount(originalMsg) + 1;

  return new Promise((resolve, reject) => {
    activeChannel.sendToQueue(
      QueueConfig.RETRY_QUEUE,
      Buffer.from(JSON.stringify(message)),
      {
        contentType: "application/json",
        deliveryMode: 2,
        persistent: true,
        timestamp: Date.now(),
        headers: {
          ...(originalMsg?.properties?.headers || {}),
          "x-retry-count": retryCount,
          "x-retry-reason": reason,
        },
      },
      (error) => {
        if (error) {
          return reject(error);
        }

        logger.warn(
          `Scheduled retry ${retryCount}/${QueueConfig.MAX_RETRY_ATTEMPTS} for occurrence ${message?.data?.sourceEventId}: ${reason}`,
        );
        return resolve(retryCount);
      },
    );
  });
}

async function sendToDlq(message, originalMsg, reason) {
  const activeChannel = channel || (await connectToRabbitMQ());

  return new Promise((resolve, reject) => {
    activeChannel.sendToQueue(
      QueueConfig.DLQ,
      Buffer.from(JSON.stringify(message)),
      {
        contentType: "application/json",
        deliveryMode: 2,
        persistent: true,
        timestamp: Date.now(),
        headers: {
          ...(originalMsg?.properties?.headers || {}),
          "x-dlq-reason": reason,
          "x-original-routing-key": originalMsg?.fields?.routingKey,
        },
      },
      (error) => {
        if (error) {
          return reject(error);
        }

        logger.error(
          `Sent occurrence ${message?.data?.sourceEventId || "unknown"} to DLQ: ${reason}`,
        );
        return resolve(true);
      },
    );
  });
}

async function consumeOccurrenceDetected(callback) {
  const activeChannel = channel || (await connectToRabbitMQ());

  await activeChannel.consume(
    QueueConfig.OCCURRENCE_QUEUE,
    async (msg) => {
      if (!msg) {
        return;
      }

      try {
        await callback(msg, activeChannel);
      } catch (error) {
        logger.error(
          `Issue consumer callback failed before ack decision: ${error.message}`,
        );
        activeChannel.nack(msg, false, true);
      }
    },
    { noAck: false },
  );

  logger.info(
    `Subscribed queue ${QueueConfig.OCCURRENCE_QUEUE} to routing key ${EventTypes.ISSUE_OCCURRENCE_DETECTED}`,
  );
}

async function closeRabbitMQ() {
  if (channel) {
    await channel.close();
  }

  if (connection) {
    await connection.close();
  }

  channel = null;
  connection = null;
  logger.info("RabbitMQ connection closed gracefully");
}

module.exports = {
  closeRabbitMQ,
  connectToRabbitMQ,
  consumeOccurrenceDetected,
  getRetryCount,
  sendToDlq,
  sendToRetryQueue,
};
