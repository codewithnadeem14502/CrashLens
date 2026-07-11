const parser = require("cron-parser");
const { ApiError, ScheduleType } = require("./constants");

// Single place that turns a Monitor's schedule config into "when is the
// next expected check-in", used both at create/update time and by the cron
// sweep after resolving a window (missed or ok). Keeping this in one
// function means the sweep and the controller can never disagree about how
// a schedule maps to a timestamp.
const computeNextExpectedAt = (monitor, fromDate = new Date()) => {
  if (monitor.scheduleType === ScheduleType.INTERVAL) {
    return new Date(fromDate.getTime() + monitor.intervalSeconds * 1000);
  }

  try {
    const interval = parser.parseExpression(monitor.crontab, {
      currentDate: fromDate,
      tz: monitor.timezone || "UTC",
    });

    return interval.next().toDate();
  } catch (error) {
    throw new ApiError(400, `Invalid crontab expression: ${error.message}`);
  }
};

const validateCrontab = (expression, timezone) => {
  try {
    parser.parseExpression(expression, { tz: timezone || "UTC" });
    return true;
  } catch {
    return false;
  }
};

module.exports = {
  computeNextExpectedAt,
  validateCrontab,
};
