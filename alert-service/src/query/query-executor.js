const { Dataset, Aggregate, DATASET_AGGREGATES, ApiError } = require("../utils/constants");
const serviceClient = require("./service-client");

// monitor-service's own list endpoints cap `limit` at 100
// (monitor-controller.js's MAX_LIMIT) - matched here rather than guessed,
// since requesting a higher limit would just get silently clamped anyway.
const MAX_MONITOR_PAGE_SIZE = 100;

const assertValidCombination = (dataset, aggregate) => {
  const allowed = DATASET_AGGREGATES[dataset];

  if (!allowed || !allowed.includes(aggregate)) {
    throw new ApiError(400, `Aggregate "${aggregate}" is not valid for dataset "${dataset}"`);
  }
};

// offsetWindows=0 -> (now - window, now]; offsetWindows=1 -> the equal-
// length window immediately before that (used for percent-change rules).
const toIsoRange = (now, timeWindowMinutes, offsetWindows) => {
  const windowMs = timeWindowMinutes * 60 * 1000;
  const to = new Date(now.getTime() - offsetWindows * windowMs);
  const from = new Date(to.getTime() - windowMs);
  return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
};

// issue-service's listIssues/listLogs already compute pagination.total via
// a separate countDocuments - requesting limit=1 gets the count for free
// without pulling any document bodies over the wire.
const runIssuesCount = async (organizationId, filters, range) => {
  const data = await serviceClient.listIssues(organizationId, {
    projectId: filters.projectId,
    environment: filters.environment,
    severity: filters.severity,
    status: filters.status,
    release: filters.release,
    errorName: filters.errorName,
    search: filters.search,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    limit: 1,
  });

  const total = data.pagination?.total ?? 0;
  return { value: total, sampleSize: total };
};

const runLogsCount = async (organizationId, filters, range) => {
  const data = await serviceClient.listLogs(organizationId, {
    projectId: filters.projectId,
    level: filters.level,
    search: filters.search,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    limit: 1,
  });

  const total = data.pagination?.total ?? 0;
  return { value: total, sampleSize: total };
};

// monitor-service's list endpoints have no date-range or health-status
// filter server-side (see Module 9 design research) - this counts
// currently-unhealthy monitors from a single bounded page rather than
// windowed history, and is a snapshot, not a rolling-window count (the
// query's timeWindowMinutes is accepted for schema uniformity with the
// other datasets but not used here). Fine at this codebase's expected
// scale; an org with more than MAX_MONITOR_PAGE_SIZE active monitors would
// silently under-count past the first page - not paginated through, for
// this module's scope.
const runMonitorsCount = async (organizationId, filters) => {
  const data = await serviceClient.listMonitors(organizationId, {
    projectId: filters.projectId,
    status: "active",
    limit: MAX_MONITOR_PAGE_SIZE,
  });

  const monitors = data.monitors || [];
  const unhealthy = monitors.filter(
    (monitor) => monitor.lastCheckInStatus === "missed" || monitor.lastCheckInStatus === "timeout",
  );

  return { value: unhealthy.length, sampleSize: monitors.length };
};

const runUptimeMonitorsCount = async (organizationId, filters) => {
  const data = await serviceClient.listUptimeMonitors(organizationId, {
    projectId: filters.projectId,
    status: "active",
    limit: MAX_MONITOR_PAGE_SIZE,
  });

  const monitors = data.uptimeMonitors || [];
  const unhealthy = monitors.filter((monitor) => monitor.lastStatus === "down");

  return { value: unhealthy.length, sampleSize: monitors.length };
};

const pickTransactionValue = (aggregate, summary) => {
  switch (aggregate) {
    case Aggregate.COUNT:
      return summary.requestCount ?? 0;
    case Aggregate.AVG_DURATION_MS:
      return summary.averageDurationMs ?? 0;
    case Aggregate.P95_DURATION_MS:
      return summary.p95DurationMs ?? 0;
    case Aggregate.ERROR_RATE:
      // Already a 0-100 percentage (issue-controller.js's
      // summarizeTransactions), not a 0-1 fraction - kept consistent below.
      return summary.errorRate ?? 0;
    default:
      throw new ApiError(400, `Unsupported transactions aggregate "${aggregate}"`);
  }
};

const runTransactionsAggregate = async (organizationId, aggregate, filters, range) => {
  if (filters.endpointId) {
    const data = await serviceClient.getEndpointPerformance(organizationId, filters.endpointId, {
      projectId: filters.projectId,
      environment: filters.environment,
      release: filters.release,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    });
    const summary = data.summary || {};
    return { value: pickTransactionValue(aggregate, summary), sampleSize: summary.requestCount ?? 0 };
  }

  // No endpointId: aggregate across every endpoint listPerformanceEndpoints
  // returns. count/avg/error_rate are exact (sums/weighted averages over
  // the same per-endpoint summaries PerformancePage already trusts); p95
  // is a documented approximation - the max of each endpoint's own p95,
  // not a true global percentile across all transactions - since no
  // cross-endpoint raw-row aggregate exists in issue-service today. A
  // future module could add one; this executor calls what's real.
  const data = await serviceClient.listPerformanceEndpoints(organizationId, {
    projectId: filters.projectId,
    environment: filters.environment,
    release: filters.release,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
  });
  const endpoints = data.endpoints || [];
  const totalRequests = endpoints.reduce((sum, endpoint) => sum + (endpoint.requestCount || 0), 0);

  if (aggregate === Aggregate.COUNT) {
    return { value: totalRequests, sampleSize: totalRequests };
  }

  if (aggregate === Aggregate.AVG_DURATION_MS) {
    const weightedTotal = endpoints.reduce(
      (sum, endpoint) => sum + (endpoint.averageDurationMs || 0) * (endpoint.requestCount || 0),
      0,
    );
    return {
      value: totalRequests ? weightedTotal / totalRequests : 0,
      sampleSize: totalRequests,
    };
  }

  if (aggregate === Aggregate.P95_DURATION_MS) {
    const maxP95 = endpoints.reduce((max, endpoint) => Math.max(max, endpoint.p95DurationMs || 0), 0);
    return { value: maxP95, sampleSize: totalRequests };
  }

  if (aggregate === Aggregate.ERROR_RATE) {
    const totalErrors = endpoints.reduce((sum, endpoint) => sum + (endpoint.errorCount || 0), 0);
    return {
      value: totalRequests ? (totalErrors / totalRequests) * 100 : 0,
      sampleSize: totalRequests,
    };
  }

  throw new ApiError(400, `Unsupported transactions aggregate "${aggregate}"`);
};

const runForWindow = (query, organizationId, range) => {
  const { dataset, aggregate, filters = {} } = query;
  assertValidCombination(dataset, aggregate);

  switch (dataset) {
    case Dataset.ISSUES:
      return runIssuesCount(organizationId, filters, range);
    case Dataset.LOGS:
      return runLogsCount(organizationId, filters, range);
    case Dataset.MONITORS:
      return runMonitorsCount(organizationId, filters);
    case Dataset.UPTIME_MONITORS:
      return runUptimeMonitorsCount(organizationId, filters);
    case Dataset.TRANSACTIONS:
      return runTransactionsAggregate(organizationId, aggregate, filters, range);
    default:
      throw new ApiError(400, `Unknown dataset "${dataset}"`);
  }
};

// Single-window read - used by the widget-builder preview and by dashboard
// rendering.
const executeQuery = async (query, organizationId, now = new Date()) => {
  const range = toIsoRange(now, query.timeWindowMinutes, 0);
  const result = await runForWindow(query, organizationId, range);
  return { ...result, computedAt: now, range };
};

// Current window + the equal-length window immediately before it, plus the
// percent change between them - used by percent_change alert rules and by
// the rule-builder preview when previewing that threshold type.
//
// previous.value === 0 has no true percentage (division by zero). Rather
// than propagate NaN/Infinity into a threshold comparison, this is
// deliberately capped: no change at all is 0%, any nonzero value appearing
// from a zero baseline is reported as a flat 100% - an approximation, not
// a precise percentage, called out here so it isn't mistaken for one.
const executeQueryWithChange = async (query, organizationId, now = new Date()) => {
  const currentRange = toIsoRange(now, query.timeWindowMinutes, 0);
  const previousRange = toIsoRange(now, query.timeWindowMinutes, 1);

  const [current, previous] = await Promise.all([
    runForWindow(query, organizationId, currentRange),
    runForWindow(query, organizationId, previousRange),
  ]);

  const percentChange =
    previous.value === 0
      ? current.value === 0
        ? 0
        : 100
      : ((current.value - previous.value) / Math.abs(previous.value)) * 100;

  return { current, previous, percentChange, computedAt: now };
};

module.exports = { executeQuery, executeQueryWithChange, assertValidCombination };
