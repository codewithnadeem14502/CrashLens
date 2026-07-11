const amqp = require("amqplib");
const { QueueConfig } = require("./constants");
const logger = require("./logger");

let connection = null;
let channel = null;

async function connectToRabbitMQ() {
  try {
    if (channel) {
      return channel;
    }

    connection = await amqp.connect(QueueConfig.RABBITMQ_URL);
    // Confirm channel (not a plain channel): publish() alone only tells you
    // whether the local write buffer accepted the write, not whether the
    // broker actually received/routed the message. Without publisher
    // confirms, a publish can "succeed" from the caller's point of view even
    // when the broker never got it - which is exactly how project-events.js
    // used to swallow publish failures silently.
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

// Terminal safety net for a project lifecycle event that failed to publish
// even after MAX_RETRY_ATTEMPTS (see publishProjectEvent in
// events/project-events.js) - durably persists the event instead of losing
// it, so it can be inspected/replayed later. Mirrors the header conventions
// worker-service/issue-service's sendToDlq already use (x-dlq-reason,
// x-original-routing-key), for consistency across services' DLQ tooling.
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

async function consumeEvent(routingKey, callback) {
  if (!channel) {
    await connectToRabbitMQ();
  }

  const q = await channel.assertQueue("", { exclusive: true });
  await channel.bindQueue(q.queue, QueueConfig.EXCHANGE_NAME, routingKey);
  channel.consume(q.queue, (msg) => {
    if (msg !== null) {
      const content = JSON.parse(msg.content.toString());
      callback(content);
      channel.ack(msg);
    }
  });

  logger.info(`Subscribed to event: ${routingKey}`);
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
  consumeEvent,
};
