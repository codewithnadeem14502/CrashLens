const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateTransactionEnvelope } = require("../src/events/performance-events");
const { MAX_TRANSACTION_SPANS } = require("../src/models/issue-model");
const { EventTypes } = require("../src/utils/constants");

// Defense-in-depth regression test: event-service's Joi schema caps spans
// at ingestion time, but this consumer trusts whatever's actually on the
// queue - a message crafted/replayed directly onto RabbitMQ (bypassing
// event-service entirely) must still be rejected here, fast, before ever
// reaching the DB.
const validEnvelope = (transactionOverrides = {}) => ({
  eventType: EventTypes.TRANSACTION_INGESTED,
  data: {
    transactionId: "txn-1",
    projectId: "507f1f77bcf86cd799439011",
    organizationId: "507f1f77bcf86cd799439022",
    transaction: {
      method: "GET",
      route: "/orders/:id",
      durationMs: 42,
      statusCode: 200,
      ...transactionOverrides,
    },
  },
});

test("rejects a transaction.spans array longer than MAX_TRANSACTION_SPANS", () => {
  const tooMany = Array.from({ length: MAX_TRANSACTION_SPANS + 1 }, (_, i) => ({
    spanId: `span-${i}`,
  }));

  assert.throws(
    () => validateTransactionEnvelope(validEnvelope({ spans: tooMany })),
    (error) => error.details.some((detail) => /spans must be an array of at most/.test(detail)),
  );
});

test("accepts a transaction.spans array at exactly MAX_TRANSACTION_SPANS", () => {
  const exactlyMax = Array.from({ length: MAX_TRANSACTION_SPANS }, (_, i) => ({
    spanId: `span-${i}`,
  }));

  assert.doesNotThrow(() => validateTransactionEnvelope(validEnvelope({ spans: exactlyMax })));
});

test("rejects a non-array spans field", () => {
  assert.throws(
    () => validateTransactionEnvelope(validEnvelope({ spans: "not-an-array" })),
    (error) => error.details.some((detail) => /spans must be an array/.test(detail)),
  );
});

test("accepts a transaction with no spans field at all", () => {
  assert.doesNotThrow(() => validateTransactionEnvelope(validEnvelope()));
});
