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
  await channel.assertQueue(QueueConfig.TRANSACTION_DLQ, {
    durable: true,
    arguments: { "x-message-ttl": QueueConfig.TRANSACTION_DLQ_TTL_MS },
  });

  await channel.assertQueue(QueueConfig.OCCURRENCE_QUEUE, { durable: true });
  await channel.bindQueue(
    QueueConfig.OCCURRENCE_QUEUE,
    QueueConfig.EXCHANGE_NAME,
    EventTypes.ISSUE_OCCURRENCE_DETECTED,
  );

  await channel.assertQueue(QueueConfig.TRANSACTION_QUEUE, { durable: true });
  await channel.bindQueue(
    QueueConfig.TRANSACTION_QUEUE,
    QueueConfig.EXCHANGE_NAME,
    EventTypes.TRANSACTION_INGESTED,
  );

  await channel.assertQueue(QueueConfig.LOG_DLQ, {
    durable: true,
    arguments: { "x-message-ttl": QueueConfig.LOG_DLQ_TTL_MS },
  });

  await channel.assertQueue(QueueConfig.LOG_QUEUE, { durable: true });
  await channel.bindQueue(
    QueueConfig.LOG_QUEUE,
    QueueConfig.EXCHANGE_NAME,
    EventTypes.LOGS_INGESTED,
  );

  await channel.assertQueue(QueueConfig.RETRY_QUEUE, {
    durable: true,
    arguments: {
      "x-message-ttl": QueueConfig.RETRY_DELAY_MS,
      "x-dead-letter-exchange": QueueConfig.EXCHANGE_NAME,
      "x-dead-letter-routing-key": EventTypes.ISSUE_OCCURRENCE_DETECTED,
    },
  });

  await channel.assertQueue(QueueConfig.TRANSACTION_RETRY_QUEUE, {
    durable: true,
    arguments: {
      "x-message-ttl": QueueConfig.RETRY_DELAY_MS,
      "x-dead-letter-exchange": QueueConfig.EXCHANGE_NAME,
      "x-dead-letter-routing-key": EventTypes.TRANSACTION_INGESTED,
    },
  });

  await channel.assertQueue(QueueConfig.LOG_RETRY_QUEUE, {
    durable: true,
    arguments: {
      "x-message-ttl": QueueConfig.RETRY_DELAY_MS,
      "x-dead-letter-exchange": QueueConfig.EXCHANGE_NAME,
      "x-dead-letter-routing-key": EventTypes.LOGS_INGESTED,
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

async function sendTransactionToRetryQueue(message, originalMsg, reason) {
  const activeChannel = channel || (await connectToRabbitMQ());
  const retryCount = getRetryCount(originalMsg) + 1;

  return new Promise((resolve, reject) => {
    activeChannel.sendToQueue(
      QueueConfig.TRANSACTION_RETRY_QUEUE,
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
          `Scheduled retry ${retryCount}/${QueueConfig.MAX_RETRY_ATTEMPTS} for transaction ${message?.data?.transactionId || "unknown"}: ${reason}`,
        );
        return resolve(retryCount);
      },
    );
  });
}

async function sendTransactionToDlq(message, originalMsg, reason) {
  const activeChannel = channel || (await connectToRabbitMQ());

  return new Promise((resolve, reject) => {
    activeChannel.sendToQueue(
      QueueConfig.TRANSACTION_DLQ,
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
          `Sent transaction ${message?.data?.transactionId || "unknown"} to DLQ: ${reason}`,
        );
        return resolve(true);
      },
    );
  });
}

async function sendLogsToRetryQueue(message, originalMsg, reason) {
  const activeChannel = channel || (await connectToRabbitMQ());
  const retryCount = getRetryCount(originalMsg) + 1;

  return new Promise((resolve, reject) => {
    activeChannel.sendToQueue(
      QueueConfig.LOG_RETRY_QUEUE,
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
          `Scheduled retry ${retryCount}/${QueueConfig.MAX_RETRY_ATTEMPTS} for log batch ${message?.data?.batchId || "unknown"}: ${reason}`,
        );
        return resolve(retryCount);
      },
    );
  });
}

async function sendLogsToDlq(message, originalMsg, reason) {
  const activeChannel = channel || (await connectToRabbitMQ());

  return new Promise((resolve, reject) => {
    activeChannel.sendToQueue(
      QueueConfig.LOG_DLQ,
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
          `Sent log batch ${message?.data?.batchId || "unknown"} to DLQ: ${reason}`,
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

async function consumeTransactionIngested(callback) {
  const activeChannel = channel || (await connectToRabbitMQ());

  await activeChannel.consume(
    QueueConfig.TRANSACTION_QUEUE,
    async (msg) => {
      if (!msg) {
        return;
      }

      try {
        await callback(msg, activeChannel);
      } catch (error) {
        logger.error(
          `Transaction consumer callback failed before ack decision: ${error.message}`,
        );
        activeChannel.nack(msg, false, false);
      }
    },
    { noAck: false },
  );

  logger.info(
    `Subscribed queue ${QueueConfig.TRANSACTION_QUEUE} to routing key ${EventTypes.TRANSACTION_INGESTED}`,
  );
}

async function consumeLogsIngested(callback) {
  const activeChannel = channel || (await connectToRabbitMQ());

  await activeChannel.consume(
    QueueConfig.LOG_QUEUE,
    async (msg) => {
      if (!msg) {
        return;
      }

      try {
        await callback(msg, activeChannel);
      } catch (error) {
        logger.error(
          `Log consumer callback failed before ack decision: ${error.message}`,
        );
        activeChannel.nack(msg, false, false);
      }
    },
    { noAck: false },
  );

  logger.info(
    `Subscribed queue ${QueueConfig.LOG_QUEUE} to routing key ${EventTypes.LOGS_INGESTED}`,
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
  consumeLogsIngested,
  consumeOccurrenceDetected,
  consumeTransactionIngested,
  getRetryCount,
  sendLogsToDlq,
  sendLogsToRetryQueue,
  sendTransactionToDlq,
  sendTransactionToRetryQueue,
  sendToDlq,
  sendToRetryQueue,
};
