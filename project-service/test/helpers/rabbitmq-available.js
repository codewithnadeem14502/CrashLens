const net = require("node:net");
const { URL } = require("node:url");

// Quick TCP reachability check (not a real AMQP handshake) so tests that
// need a live broker can skip cleanly instead of hard-failing when no
// RabbitMQ is running - e.g. a contributor's machine or a CI job that
// doesn't spin one up. amqp.connect() itself can also hang far longer than
// a plain TCP connect on an unreachable host, so this keeps the skip fast.
const isRabbitMQReachable = (url = process.env.RABBITMQ_URL || "amqp://localhost:5672") =>
  new Promise((resolve) => {
    let host = "localhost";
    let port = 5672;

    try {
      const parsed = new URL(url.replace(/^amqp/, "http"));
      host = parsed.hostname || host;
      port = parsed.port ? Number.parseInt(parsed.port, 10) : port;
    } catch {
      // fall back to defaults above
    }

    const socket = net.connect({ host, port, timeout: 1000 });

    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });

module.exports = { isRabbitMQReachable };
