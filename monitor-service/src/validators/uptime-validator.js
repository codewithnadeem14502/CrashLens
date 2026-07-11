const Joi = require("joi");
const { Environments, MonitorStatus } = require("../utils/constants");

const objectId = Joi.string().hex().length(24);
const page = Joi.number().integer().min(1);
const limit = Joi.number().integer().min(1);

const createUptimeMonitorBody = Joi.object({
  projectId: objectId.required(),
  name: Joi.string().trim().min(2).max(200).required(),
  url: Joi.string().uri({ scheme: ["http", "https"] }).max(2048).required(),
  method: Joi.string().trim().uppercase().max(10),
  headers: Joi.object().unknown(true).max(50),
  body: Joi.string().max(4000),
  intervalSeconds: Joi.number().integer().min(30),
  timeoutMs: Joi.number().integer().min(1000).max(30000),
  expectedStatusMin: Joi.number().integer().min(100).max(599),
  expectedStatusMax: Joi.number().integer().min(100).max(599),
  consecutiveFailureThreshold: Joi.number().integer().min(1),
  environment: Joi.string().valid(...Object.values(Environments)),
}).unknown(false);

const updateUptimeMonitorBody = Joi.object({
  name: Joi.string().trim().min(2).max(200),
  status: Joi.string().valid(...Object.values(MonitorStatus)),
  url: Joi.string().uri({ scheme: ["http", "https"] }).max(2048),
  method: Joi.string().trim().uppercase().max(10),
  headers: Joi.object().unknown(true).max(50),
  body: Joi.string().max(4000),
  intervalSeconds: Joi.number().integer().min(30),
  timeoutMs: Joi.number().integer().min(1000).max(30000),
  expectedStatusMin: Joi.number().integer().min(100).max(599),
  expectedStatusMax: Joi.number().integer().min(100).max(599),
  consecutiveFailureThreshold: Joi.number().integer().min(1),
  environment: Joi.string().valid(...Object.values(Environments)),
})
  .unknown(false)
  .min(1);

const listUptimeMonitorsQuery = Joi.object({
  page,
  limit,
  projectId: objectId,
  status: Joi.string().valid(...Object.values(MonitorStatus)),
}).unknown(false);

const uptimeMonitorParams = Joi.object({
  uptimeMonitorId: objectId.required(),
}).unknown(false);

const listChecksQuery = Joi.object({
  page,
  limit,
}).unknown(false);

module.exports = {
  createUptimeMonitor: { body: createUptimeMonitorBody },
  updateUptimeMonitor: { params: uptimeMonitorParams, body: updateUptimeMonitorBody },
  listUptimeMonitors: { query: listUptimeMonitorsQuery },
  getUptimeMonitor: { params: uptimeMonitorParams },
  deleteUptimeMonitor: { params: uptimeMonitorParams },
  listChecks: { params: uptimeMonitorParams, query: listChecksQuery },
};
