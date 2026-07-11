const { Monitor, CheckIn } = require("../models/monitor-model");
const { computeNextExpectedAt } = require("../utils/schedule");
const { CheckInStatus, MonitorStatus, Severity } = require("../utils/constants");
const { publishOccurrence } = require("../events/occurrence-publisher");
const logger = require("../utils/logger");

const DEFAULT_SWEEP_INTERVAL_MS = Number.parseInt(
  process.env.CRON_SWEEP_INTERVAL_MS || "30000",
  10,
);

// Finds active monitors whose expected check-in window (plus grace period)
// has passed with nothing recorded for it, records a "missed" CheckIn, and
// tells issue-service about it. Advances nextExpectedAt from *now* (not
// from the missed window) so a monitor that's been down for a while doesn't
// immediately re-trigger on the very next sweep tick for the same gap.
const sweepMissedCheckIns = async (now = new Date()) => {
  const dueMonitors = await Monitor.find({
    status: MonitorStatus.ACTIVE,
    nextExpectedAt: { $ne: null },
    $expr: {
      $lte: [
        { $add: ["$nextExpectedAt", { $multiply: ["$checkinMarginSeconds", 1000] }] },
        now,
      ],
    },
  });

  let processed = 0;

  for (const monitor of dueMonitors) {
    const missedWindow = monitor.nextExpectedAt;

    await CheckIn.create({
      monitorId: monitor._id,
      projectId: monitor.projectId,
      organizationId: monitor.organizationId,
      status: CheckInStatus.MISSED,
      startedAt: missedWindow,
      finishedAt: now,
    });

    monitor.lastCheckInStatus = CheckInStatus.MISSED;
    monitor.nextExpectedAt = computeNextExpectedAt(monitor, now);
    await monitor.save();

    await publishOccurrence({
      sourceEventId: `monitor-missed-${monitor._id}-${missedWindow.getTime()}`,
      projectId: monitor.projectId.toString(),
      organizationId: monitor.organizationId.toString(),
      fingerprint: `monitor:${monitor._id}`,
      fingerprintVersion: "v1",
      message: `Monitor "${monitor.name}" missed its check-in`,
      errorName: "MonitorMissed",
      culprit: monitor.slug,
      severity: Severity.MEDIUM,
      environment: monitor.environment,
      occurredAt: missedWindow.toISOString(),
      receivedAt: now.toISOString(),
    });

    logger.warn(`Monitor ${monitor._id} (${monitor.name}) missed its check-in`);
    processed += 1;
  }

  return processed;
};

// Finds in_progress check-ins whose own max-runtime deadline has passed
// (the job started but never reported back - hung, crashed, or the ping
// just never arrived) and marks them timed out. Also advances the parent
// monitor's nextExpectedAt (same reasoning as an ok/error check-in
// finishing normally - see advanceMonitorAfterCheckIn in
// monitor-controller.js) so the missed-check-in sweep above doesn't
// *additionally* flag the same already-bad window once the grace period
// passes too.
const sweepTimedOutCheckIns = async (now = new Date()) => {
  const overdueCheckIns = await CheckIn.find({
    status: CheckInStatus.IN_PROGRESS,
    timeoutAt: { $ne: null, $lte: now },
  });

  let processed = 0;

  for (const checkIn of overdueCheckIns) {
    const monitor = await Monitor.findById(checkIn.monitorId);

    checkIn.status = CheckInStatus.TIMEOUT;
    checkIn.finishedAt = now;
    checkIn.durationMs = now.getTime() - checkIn.startedAt.getTime();
    await checkIn.save();

    if (!monitor) {
      // Monitor was deleted while its check-in was still in flight -
      // nothing left to notify or advance.
      logger.warn(`Timed-out check-in ${checkIn._id} has no parent monitor (deleted?)`);
      continue;
    }

    monitor.lastCheckInStatus = CheckInStatus.TIMEOUT;
    monitor.nextExpectedAt = computeNextExpectedAt(monitor, now);
    await monitor.save();

    await publishOccurrence({
      sourceEventId: `monitor-timeout-${checkIn._id}`,
      projectId: monitor.projectId.toString(),
      organizationId: monitor.organizationId.toString(),
      fingerprint: `monitor:${monitor._id}`,
      fingerprintVersion: "v1",
      message: `Monitor "${monitor.name}" check-in timed out after ${monitor.maxRuntimeSeconds}s`,
      errorName: "MonitorTimeout",
      culprit: monitor.slug,
      severity: Severity.HIGH,
      environment: monitor.environment,
      occurredAt: checkIn.startedAt.toISOString(),
      receivedAt: now.toISOString(),
    });

    logger.warn(`Check-in ${checkIn._id} for monitor ${monitor._id} timed out`);
    processed += 1;
  }

  return processed;
};

let isRunning = false;
let intervalHandle = null;

const runSweep = async () => {
  if (isRunning) {
    logger.debug("Skipping cron sweep tick - previous run still in progress");
    return;
  }

  isRunning = true;

  try {
    const now = new Date();
    const missed = await sweepMissedCheckIns(now);
    const timedOut = await sweepTimedOutCheckIns(now);

    if (missed || timedOut) {
      logger.info(`Cron sweep: ${missed} missed, ${timedOut} timed out`);
    }
  } catch (error) {
    logger.error(`Cron sweep failed: ${error.message}`);
  } finally {
    isRunning = false;
  }
};

const startCronSweep = (intervalMs = DEFAULT_SWEEP_INTERVAL_MS) => {
  if (intervalHandle) {
    return intervalHandle;
  }

  intervalHandle = setInterval(runSweep, intervalMs);
  intervalHandle.unref?.();
  logger.info(`Cron sweep started (every ${intervalMs}ms)`);
  return intervalHandle;
};

const stopCronSweep = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};

module.exports = {
  sweepMissedCheckIns,
  sweepTimedOutCheckIns,
  runSweep,
  startCronSweep,
  stopCronSweep,
};
