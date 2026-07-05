const amqp = require("amqplib");
const logger = require("./logger");

let connection = null;
let channel = null;

const EXCHANGE_NAME = process.env.RABBITMQ_EXCHANGE || "crashlens.events";
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";

async function connectToRabbitMQ() {
  try {
    if (channel) {
      return channel;
    }

    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });

    connection.on("close", () => {
      logger.warn("RabbitMQ connection closed");
      connection = null;
      channel = null;
    });

    connection.on("error", (error) => {
      logger.error(`RabbitMQ connection error: ${error.message}`);
    });

    logger.info(`Connected to RabbitMQ exchange ${EXCHANGE_NAME}`);
    return channel;
  } catch (error) {
    logger.error("Error connecting RabbitMQ", error);
    throw error;
  }
}

async function publishEvent(routingKey, message) {
  if (!channel) {
    await connectToRabbitMQ();
  }

  const published = channel.publish(
    EXCHANGE_NAME,
    routingKey,
    Buffer.from(JSON.stringify(message)),
    {
      contentType: "application/json",
      deliveryMode: 2,
      persistent: true,
      timestamp: Date.now(),
    },
  );

  logger.info(`Published event with routing key: ${routingKey}`);
  return published;
}

async function consumeEvent(routingKey, callback) {
  if (!channel) {
    await connectToRabbitMQ();
  }

  const q = await channel.assertQueue("", { exclusive: true });
  await channel.bindQueue(q.queue, EXCHANGE_NAME, routingKey);
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
  consumeEvent,
};
