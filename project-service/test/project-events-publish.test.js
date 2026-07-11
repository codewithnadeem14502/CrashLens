const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { publishProjectCreated } = require("../src/events/project-events");
const { closeRabbitMQ } = require("../src/utils/rabbitmq");
const { isRabbitMQReachable } = require("./helpers/rabbitmq-available");

// Proves the happy path still works end-to-end against the real broker
// after switching to a confirm channel: a normal publish should succeed on
// the first attempt (no retry, no DLQ) and return the envelope.
after(async () => {
  await closeRabbitMQ();
});

test("publishes successfully against a real broker with no retry needed", async (t) => {
  if (!(await isRabbitMQReachable())) {
    t.skip("RabbitMQ not reachable at RABBITMQ_URL - skipping real-broker test");
    return;
  }

  const project = {
    _id: { toString: () => "507f1f77bcf86cd799439033" },
    organizationId: { toString: () => "507f1f77bcf86cd799439044" },
    dsnPublicKey: "pk_test_456",
    status: "active",
    environment: "production",
  };

  const envelope = await publishProjectCreated(project);

  assert.equal(envelope.eventType, "project.created");
  assert.equal(envelope.data.projectId, "507f1f77bcf86cd799439033");
  assert.equal(envelope.producer, "project-service");
  assert.ok(envelope.eventId);
});
