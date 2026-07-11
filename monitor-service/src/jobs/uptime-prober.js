const { UptimeMonitor, UptimeCheck } = require("../models/uptime-model");
const { MonitorStatus, Severity, UptimeStatus } = require("../utils/constants");
const { publishOccurrence } = require("../events/occurrence-publisher");
const logger = require("../utils/logger");

const DEFAULT_PROBE_INTERVAL_MS = Number.parseInt(
  process.env.UPTIME_PROBE_INTERVAL_MS || "15000",
  10,
);

// A plain indexed range query against the precomputed nextProbeAt field
// (see models/uptime-model.js) - previously this used $expr to compare
// lastCheckedAt + intervalSeconds against now, which can't use a btree
// index for the actual due-check (backend review finding, Module 8).
const findDueUptimeMonitors = (now) =>
  UptimeMonitor.find({
    status: MonitorStatus.ACTIVE,
    nextProbeAt: { $lte: now },
  });

// Native fetch + AbortController, no new HTTP client dependency - matches
// the SDK's own zero-dependency-transport convention. Never throws: every
// outcome (success, non-matching status, network error, timeout) resolves
// to a {status, statusCode, responseTimeMs, error} shape so the caller
// doesn't need a try/catch per monitor.
const probeUrl = async (monitor) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), monitor.timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(monitor.url, {
      method: monitor.method || "GET",
      headers: monitor.headers instanceof Map
        ? Object.fromEntries(monitor.headers)
        : monitor.headers || undefined,
      body: monitor.body || undefined,
      signal: controller.signal,
    });

    const responseTimeMs = Date.now() - startedAt;
    const isExpectedStatus =
      response.status >= monitor.expectedStatusMin &&
      response.status <= monitor.expectedStatusMax;

    return {
      status: isExpectedStatus ? UptimeStatus.UP : UptimeStatus.DOWN,
      statusCode: response.status,
      responseTimeMs,
      error: isExpectedStatus
        ? undefined
        : `Unexpected status code ${response.status} (expected ${monitor.expectedStatusMin}-${monitor.expectedStatusMax})`,
    };
  } catch (error) {
    return {
      status: UptimeStatus.DOWN,
      statusCode: undefined,
      responseTimeMs: Date.now() - startedAt,
      error: controller.signal.aborted
        ? `Request timed out after ${monitor.timeoutMs}ms`
        : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
};

const probeOneMonitor = async (monitor, now) => {
  const result = await probeUrl(monitor);

  await UptimeCheck.create({
    uptimeMonitorId: monitor._id,
    projectId: monitor.projectId,
    organizationId: monitor.organizationId,
    status: result.status,
    statusCode: result.statusCode,
    responseTimeMs: result.responseTimeMs,
    error: result.error,
    checkedAt: now,
  });

  monitor.lastCheckedAt = now;
  monitor.lastStatus = result.status;
  // Advanced on every probe outcome, success or failure - the check cadence
  // itself doesn't pause just because the target is currently down.
  monitor.nextProbeAt = new Date(now.getTime() + monitor.intervalSeconds * 1000);

  if (result.status === UptimeStatus.UP) {
    monitor.consecutiveFailures = 0;
    // Reset regardless of whether an incident was ever opened - a future
    // run of failures should always be able to open (and notify about) a
    // fresh incident.
    monitor.incidentOpen = false;
    await monitor.save();
    return { recovered: true };
  }

  monitor.consecutiveFailures += 1;
  const crossedThreshold = monitor.consecutiveFailures >= monitor.consecutiveFailureThreshold;
  const shouldNotify = crossedThreshold && !monitor.incidentOpen;

  if (shouldNotify) {
    monitor.incidentOpen = true;
  }

  await monitor.save();

  if (shouldNotify) {
    await publishOccurrence({
      sourceEventId: `uptime-down-${monitor._id}-${now.getTime()}`,
      projectId: monitor.projectId.toString(),
      organizationId: monitor.organizationId.toString(),
      fingerprint: `uptime:${monitor._id}`,
      fingerprintVersion: "v1",
      message: `Uptime check for "${monitor.name}" (${monitor.url}) failed ${monitor.consecutiveFailures} times in a row`,
      errorName: "UptimeDown",
      culprit: monitor.url,
      severity: Severity.CRITICAL,
      environment: monitor.environment,
      occurredAt: now.toISOString(),
      receivedAt: now.toISOString(),
    });

    logger.warn(
      `Uptime monitor ${monitor._id} (${monitor.name}) opened an incident after ${monitor.consecutiveFailures} consecutive failures`,
    );
  }

  return { recovered: false, notified: shouldNotify };
};

let isRunning = false;
let intervalHandle = null;

const runProbeTick = async () => {
  if (isRunning) {
    logger.debug("Skipping uptime probe tick - previous run still in progress");
    return;
  }

  isRunning = true;

  try {
    const now = new Date();
    const dueMonitors = await findDueUptimeMonitors(now);

    if (!dueMonitors.length) {
      return;
    }

    const results = await Promise.allSettled(
      dueMonitors.map((monitor) => probeOneMonitor(monitor, now)),
    );

    const failed = results.filter((result) => result.status === "rejected");

    if (failed.length) {
      failed.forEach((result) =>
        logger.error(`Uptime probe failed unexpectedly: ${result.reason?.message}`),
      );
    }

    logger.info(`Uptime probe tick: checked ${dueMonitors.length} monitor(s)`);
  } catch (error) {
    logger.error(`Uptime probe tick failed: ${error.message}`);
  } finally {
    isRunning = false;
  }
};

const startUptimeProber = (intervalMs = DEFAULT_PROBE_INTERVAL_MS) => {
  if (intervalHandle) {
    return intervalHandle;
  }

  intervalHandle = setInterval(runProbeTick, intervalMs);
  intervalHandle.unref?.();
  logger.info(`Uptime prober started (every ${intervalMs}ms)`);
  return intervalHandle;
};

const stopUptimeProber = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};

module.exports = {
  probeUrl,
  probeOneMonitor,
  runProbeTick,
  startUptimeProber,
  stopUptimeProber,
};
