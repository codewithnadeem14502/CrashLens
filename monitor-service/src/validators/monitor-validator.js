const Joi = require("joi");
const { Environments, MonitorStatus, ScheduleType } = require("../utils/constants");

const objectId = Joi.string().hex().length(24);
const page = Joi.number().integer().min(1);
const limit = Joi.number().integer().min(1);

// Every client-supplied filter value flowing into a Mongo query is typed
// explicitly (matches the pattern issue-service/log-validator.js and
// issue-validator.js already established) - unknown(false) on every query
// schema so an operator-injection shape like ?status[$ne]=x fails Joi
// (object where a string is expected) before it ever reaches a filter.
const createMonitorBody = Joi.object({
  projectId: objectId.required(),
  name: Joi.string().trim().min(2).max(200).required(),
  scheduleType: Joi.string().valid(...Object.values(ScheduleType)).required(),
  crontab: Joi.string().trim().max(100).when("scheduleType", {
    is: ScheduleType.CRONTAB,
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  intervalSeconds: Joi.number().integer().min(60).when("scheduleType", {
    is: ScheduleType.INTERVAL,
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  timezone: Joi.string().trim().max(100),
  checkinMarginSeconds: Joi.number().integer().min(0),
  maxRuntimeSeconds: Joi.number().integer().min(0),
  environment: Joi.string().valid(...Object.values(Environments)),
}).unknown(false);

const updateMonitorBody = Joi.object({
  name: Joi.string().trim().min(2).max(200),
  status: Joi.string().valid(...Object.values(MonitorStatus)),
  scheduleType: Joi.string().valid(...Object.values(ScheduleType)),
  crontab: Joi.string().trim().max(100),
  intervalSeconds: Joi.number().integer().min(60),
  timezone: Joi.string().trim().max(100),
  checkinMarginSeconds: Joi.number().integer().min(0),
  maxRuntimeSeconds: Joi.number().integer().min(0),
  environment: Joi.string().valid(...Object.values(Environments)),
})
  .unknown(false)
  .min(1);

const listMonitorsQuery = Joi.object({
  page,
  limit,
  projectId: objectId,
  status: Joi.string().valid(...Object.values(MonitorStatus)),
}).unknown(false);

const monitorParams = Joi.object({
  monitorId: objectId.required(),
}).unknown(false);

const listCheckInsQuery = Joi.object({
  page,
  limit,
}).unknown(false);

// Check-in ping endpoints are hit by an external cron job holding only the
// per-monitor checkToken, not a user JWT - token is required in the body
// (not the URL, so it doesn't end up in access logs/proxy logs the way a
// query-string secret would).
const createCheckInBody = Joi.object({
  token: Joi.string().required(),
  status: Joi.string().valid("in_progress", "ok", "error"),
  message: Joi.string().trim().max(2000),
}).unknown(false);

const finishCheckInBody = Joi.object({
  token: Joi.string().required(),
  status: Joi.string().valid("ok", "error").required(),
  message: Joi.string().trim().max(2000),
}).unknown(false);

const checkInParams = Joi.object({
  monitorId: objectId.required(),
  checkinId: objectId.required(),
}).unknown(false);

module.exports = {
  createMonitor: { body: createMonitorBody },
  updateMonitor: { params: monitorParams, body: updateMonitorBody },
  listMonitors: { query: listMonitorsQuery },
  getMonitor: { params: monitorParams },
  deleteMonitor: { params: monitorParams },
  regenerateToken: { params: monitorParams },
  listCheckIns: { params: monitorParams, query: listCheckInsQuery },
  createCheckIn: { params: monitorParams, body: createCheckInBody },
  finishCheckIn: { params: checkInParams, body: finishCheckInBody },
};
