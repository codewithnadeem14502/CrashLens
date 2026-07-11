const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  connectToRabbitMQ,
  sendToDlq,
  closeRabbitMQ,
} = require("../src/utils/rabbitmq");
const { isRabbitMQReachable } = require("./helpers/rabbitmq-available");

// Proves sendToDlq genuinely enqueues against the real broker (not just
// that the mock in project-events-retry.test.js was called) - connects,
// sends a message to the DLQ, and checks the queue's message count went up.
after(async () => {
  await closeRabbitMQ();
});

test("sendToDlq durably enqueues the event on the real DLQ", async (t) => {
  if (!(await isRabbitMQReachable())) {
    t.skip("RabbitMQ not reachable at RABBITMQ_URL - skipping real-broker test");
    return;
  }

  const channel = await connectToRabbitMQ();
  const before = await channel.checkQueue("project-service.events.dlq");

  await sendToDlq(
    { eventId: "test-event-id", eventType: "project.created" },
    "project.created",
    "integration test",
  );

  const after1 = await channel.checkQueue("project-service.events.dlq");

  assert.equal(after1.messageCount, before.messageCount + 1);

  // Drain the message we just added so repeated test runs don't pile up.
  const msg = await channel.get("project-service.events.dlq", { noAck: true });
  assert.ok(msg, "expected to be able to read back the message we just sent");
  const body = JSON.parse(msg.content.toString());
  assert.equal(body.eventId, "test-event-id");
});
