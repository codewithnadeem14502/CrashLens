const amqp = require("amqplib");
const { QueueConfig } = require("./constants");
const logger = require("./logger");

let connection = null;
let channel = null;

// Publisher-only - monitor-service doesn't consume from any queue (it has
// no DsnCache-style sync need: check-ins are authenticated by a per-monitor
// token stored on the Monitor document itself, not a DSN, so there's no
// project-lifecycle mirror to keep in sync here).
async function connectToRabbitMQ() {
  try {
    if (channel) {
      return channel;
    }

    connection = await amqp.connect(QueueConfig.RABBITMQ_URL);
    // Confirm channel, not a plain channel - see project-service's
    // utils/rabbitmq.js for why (publish() alone doesn't prove broker
    // receipt).
    channel = await connection.createConfirmChannel();

    await channel.assertExchange(QueueConfig.EXCHANGE_NAME, "topic", {
      durable: true,
    });

    await channel.assertQueue(QueueConfig.DLQ, {
      durable: true,
      arguments: { "x-message-ttl": QueueConfig.DLQ_MESSAGE_TTL_MS },
    });

    connection.on("close", () => {
      logger.warn("RabbitMQ connection closed");
      connection = null;
      channel = null;
    });

    connection.on("error", (error) => {
      logger.error(`RabbitMQ connection error: ${error.message}`);
    });

    logger.info(`Connected to RabbitMQ exchange ${QueueConfig.EXCHANGE_NAME}`);
    return channel;
  } catch (error) {
    logger.error("Error connecting RabbitMQ", error);
    throw error;
  }
}

async function publishEvent(routingKey, message, options = {}) {
  const activeChannel = channel || (await connectToRabbitMQ());
  const payload = Buffer.from(JSON.stringify(message));

  return new Promise((resolve, reject) => {
    activeChannel.publish(
      QueueConfig.EXCHANGE_NAME,
      routingKey,
      payload,
      {
        contentType: "application/json",
        deliveryMode: 2,
        persistent: true,
        timestamp: Date.now(),
        ...options,
      },
      (error) => {
        if (error) {
          return reject(error);
        }

        logger.info(`Published event with routing key: ${routingKey}`);
        return resolve(true);
      },
    );
  });
}

async function sendToDlq(message, routingKey, reason) {
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
          "x-dlq-reason": reason,
          "x-original-routing-key": routingKey,
        },
      },
      (error) => {
        if (error) {
          return reject(error);
        }

        logger.error(
          `Sent event ${message?.eventId || "unknown"} (routing key ${routingKey}) to DLQ: ${reason}`,
        );
        return resolve(true);
      },
    );
  });
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
}

module.exports = {
  closeRabbitMQ,
  connectToRabbitMQ,
  publishEvent,
  sendToDlq,
};
