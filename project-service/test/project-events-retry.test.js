const { test, after } = require("node:test");
const assert = require("node:assert/strict");

// Fast retry/backoff for this test only - process-isolated by node:test, so
// this doesn't affect other test files' env.
process.env.MAX_RETRY_ATTEMPTS = "2";
process.env.PROJECT_EVENTS_RETRY_DELAY_MS = "10";

const rabbitmqUtils = require("../src/utils/rabbitmq");

// Regression test for the Module 2 P0 fix: publishProjectEvent used to
// swallow a publish failure entirely (log-and-drop, no retry, nothing
// durable left behind). Mock the two functions project-events.js pulls off
// this module - since it destructures them at require time, overwriting
// these properties BEFORE first requiring project-events.js means the
// mocks are what it actually calls, with no real broker connection needed
// for this test.
let publishCallCount = 0;
const publishAttempts = [];
rabbitmqUtils.publishEvent = async (routingKey, envelope) => {
  publishCallCount += 1;
  publishAttempts.push({ routingKey, envelope });
  throw new Error("simulated broker rejection");
};

let dlqCallCount = 0;
let lastDlqCall = null;
rabbitmqUtils.sendToDlq = async (message, routingKey, reason) => {
  dlqCallCount += 1;
  lastDlqCall = { message, routingKey, reason };
  return true;
};

const { publishProjectCreated } = require("../src/events/project-events");

after(async () => {
  await rabbitmqUtils.closeRabbitMQ();
});

test("retries a failed publish MAX_RETRY_ATTEMPTS times, then sends the event to the DLQ instead of dropping it", async () => {
  const project = {
    _id: { toString: () => "507f1f77bcf86cd799439011" },
    organizationId: { toString: () => "507f1f77bcf86cd799439022" },
    dsnPublicKey: "pk_test_123",
    status: "active",
    environment: "production",
  };

  const envelope = await publishProjectCreated(project);

  assert.equal(publishCallCount, 2, "expected exactly MAX_RETRY_ATTEMPTS publish attempts");
  assert.equal(dlqCallCount, 1, "expected the event to be sent to the DLQ after exhausting retries");
  assert.equal(lastDlqCall.routingKey, "project.created");
  assert.match(lastDlqCall.reason, /simulated broker rejection/);
  assert.equal(lastDlqCall.message.eventId, envelope.eventId);

  // The caller (project-controller.js) still gets the envelope back either
  // way - publishProjectEvent never throws, so a broker outage can't fail
  // the HTTP request that triggered it.
  assert.equal(envelope.eventType, "project.created");
  assert.equal(envelope.data.projectId, "507f1f77bcf86cd799439011");
});
