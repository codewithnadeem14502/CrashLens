const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const serviceClient = require("../src/query/service-client");
const { executeQuery, executeQueryWithChange } = require("../src/query/query-executor");
const { Dataset, Aggregate } = require("../src/utils/constants");

afterEach(() => {
  mock.restoreAll();
});

test("rejects an aggregate that isn't valid for the dataset (e.g. avg_duration_ms on issues)", async () => {
  await assert.rejects(
    () => executeQuery({ dataset: Dataset.ISSUES, aggregate: Aggregate.AVG_DURATION_MS, filters: {}, timeWindowMinutes: 60 }, "org1"),
    /not valid for dataset/,
  );
});

test("issues count reads pagination.total from listIssues, not a fetched document count", async () => {
  mock.method(serviceClient, "listIssues", async () => ({ pagination: { total: 42 } }));

  const result = await executeQuery(
    { dataset: Dataset.ISSUES, aggregate: Aggregate.COUNT, filters: { severity: "critical" }, timeWindowMinutes: 30 },
    "org1",
  );

  assert.equal(result.value, 42);
  assert.equal(result.sampleSize, 42);
});

test("issues count passes the resolved time window as dateFrom/dateTo", async () => {
  let capturedParams;
  mock.method(serviceClient, "listIssues", async (organizationId, params) => {
    capturedParams = params;
    return { pagination: { total: 0 } };
  });

  const now = new Date("2026-01-01T12:00:00.000Z");
  await executeQuery({ dataset: Dataset.ISSUES, aggregate: Aggregate.COUNT, filters: {}, timeWindowMinutes: 60 }, "org1", now);

  assert.equal(capturedParams.dateTo, "2026-01-01T12:00:00.000Z");
  assert.equal(capturedParams.dateFrom, "2026-01-01T11:00:00.000Z");
});

test("logs count reads pagination.total from listLogs", async () => {
  mock.method(serviceClient, "listLogs", async () => ({ pagination: { total: 7 } }));

  const result = await executeQuery(
    { dataset: Dataset.LOGS, aggregate: Aggregate.COUNT, filters: { level: "error" }, timeWindowMinutes: 15 },
    "org1",
  );

  assert.equal(result.value, 7);
});

test("monitors count filters to only missed/timeout monitors from the returned page", async () => {
  mock.method(serviceClient, "listMonitors", async () => ({
    monitors: [
      { lastCheckInStatus: "ok" },
      { lastCheckInStatus: "missed" },
      { lastCheckInStatus: "timeout" },
      { lastCheckInStatus: "ok" },
    ],
  }));

  const result = await executeQuery(
    { dataset: Dataset.MONITORS, aggregate: Aggregate.COUNT, filters: {}, timeWindowMinutes: 60 },
    "org1",
  );

  assert.equal(result.value, 2);
  assert.equal(result.sampleSize, 4);
});

test("uptime monitors count filters to only down monitors", async () => {
  mock.method(serviceClient, "listUptimeMonitors", async () => ({
    uptimeMonitors: [{ lastStatus: "up" }, { lastStatus: "down" }],
  }));

  const result = await executeQuery(
    { dataset: Dataset.UPTIME_MONITORS, aggregate: Aggregate.COUNT, filters: {}, timeWindowMinutes: 60 },
    "org1",
  );

  assert.equal(result.value, 1);
});

test("transactions with an endpointId reads the exact endpoint summary, not an approximation", async () => {
  mock.method(serviceClient, "getEndpointPerformance", async () => ({
    summary: { requestCount: 100, averageDurationMs: 250, p95DurationMs: 900, errorRate: 12.5 },
  }));

  const p95 = await executeQuery(
    {
      dataset: Dataset.TRANSACTIONS,
      aggregate: Aggregate.P95_DURATION_MS,
      filters: { endpointId: "GET /checkout" },
      timeWindowMinutes: 60,
    },
    "org1",
  );
  assert.equal(p95.value, 900);

  const errorRate = await executeQuery(
    {
      dataset: Dataset.TRANSACTIONS,
      aggregate: Aggregate.ERROR_RATE,
      filters: { endpointId: "GET /checkout" },
      timeWindowMinutes: 60,
    },
    "org1",
  );
  assert.equal(errorRate.value, 12.5);
});

test("transactions without an endpointId aggregates across every returned endpoint (weighted avg, max p95, weighted error rate)", async () => {
  mock.method(serviceClient, "listPerformanceEndpoints", async () => ({
    endpoints: [
      { requestCount: 100, averageDurationMs: 100, p95DurationMs: 300, errorCount: 5 },
      { requestCount: 300, averageDurationMs: 200, p95DurationMs: 900, errorCount: 15 },
    ],
  }));

  const count = await executeQuery(
    { dataset: Dataset.TRANSACTIONS, aggregate: Aggregate.COUNT, filters: {}, timeWindowMinutes: 60 },
    "org1",
  );
  assert.equal(count.value, 400);

  const avg = await executeQuery(
    { dataset: Dataset.TRANSACTIONS, aggregate: Aggregate.AVG_DURATION_MS, filters: {}, timeWindowMinutes: 60 },
    "org1",
  );
  // weighted: (100*100 + 200*300) / 400 = (10000 + 60000) / 400 = 175
  assert.equal(avg.value, 175);

  const p95 = await executeQuery(
    { dataset: Dataset.TRANSACTIONS, aggregate: Aggregate.P95_DURATION_MS, filters: {}, timeWindowMinutes: 60 },
    "org1",
  );
  assert.equal(p95.value, 900); // documented approximation: max of per-endpoint p95s

  const errorRate = await executeQuery(
    { dataset: Dataset.TRANSACTIONS, aggregate: Aggregate.ERROR_RATE, filters: {}, timeWindowMinutes: 60 },
    "org1",
  );
  // (5+15)/400 * 100 = 5
  assert.equal(errorRate.value, 5);
});

test("percent-change queries the current and previous window and computes the delta", async () => {
  const calls = [];
  mock.method(serviceClient, "listIssues", async (organizationId, params) => {
    calls.push(params);
    // First call is the current window (dateTo=now), second is the
    // previous window (dateTo=now-window) - respond accordingly.
    const isCurrent = calls.length === 1;
    return { pagination: { total: isCurrent ? 150 : 100 } };
  });

  const now = new Date("2026-01-01T12:00:00.000Z");
  const result = await executeQueryWithChange(
    { dataset: Dataset.ISSUES, aggregate: Aggregate.COUNT, filters: {}, timeWindowMinutes: 60 },
    "org1",
    now,
  );

  assert.equal(result.current.value, 150);
  assert.equal(result.previous.value, 100);
  assert.equal(result.percentChange, 50);
});

test("percent-change from a zero baseline is a documented approximation, not NaN/Infinity", async () => {
  const calls = [];
  mock.method(serviceClient, "listIssues", async () => {
    calls.push(1);
    const isCurrent = calls.length === 1;
    return { pagination: { total: isCurrent ? 5 : 0 } };
  });

  const result = await executeQueryWithChange(
    { dataset: Dataset.ISSUES, aggregate: Aggregate.COUNT, filters: {}, timeWindowMinutes: 60 },
    "org1",
  );

  assert.equal(result.percentChange, 100);
  assert.ok(Number.isFinite(result.percentChange));
});

test("percent-change from zero to zero is 0%, not NaN", async () => {
  mock.method(serviceClient, "listIssues", async () => ({ pagination: { total: 0 } }));

  const result = await executeQueryWithChange(
    { dataset: Dataset.ISSUES, aggregate: Aggregate.COUNT, filters: {}, timeWindowMinutes: 60 },
    "org1",
  );

  assert.equal(result.percentChange, 0);
});
