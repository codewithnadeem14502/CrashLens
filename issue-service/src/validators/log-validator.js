const Joi = require("joi");
const { LogLevel } = require("../utils/constants");

const objectId = Joi.string().hex().length(24);

// Same injection-sink reasoning as issue-validator.js: every client-supplied
// value that flows into a Mongoose filter must be typed explicitly, or a
// `?search[$regex]=` shape sails through untyped. Mirrored here rather than
// invented fresh.
const page = Joi.number().integer().min(1);
const limit = Joi.number().integer().min(1);
const search = Joi.string().trim().max(200);
const traceId = Joi.string().trim().max(200);
const correlationId = Joi.string().trim().max(200);
const dateFrom = Joi.string().isoDate();
const dateTo = Joi.string().isoDate();

const listLogsQuery = Joi.object({
  page,
  limit,
  projectId: objectId,
  level: Joi.string().valid(...Object.values(LogLevel)),
  traceId,
  correlationId,
  dateFrom,
  dateTo,
  search,
  order: Joi.string().valid("asc", "desc"),
}).unknown(false);

module.exports = {
  listLogs: { query: listLogsQuery },
};
