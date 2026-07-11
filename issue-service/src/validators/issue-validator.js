const Joi = require("joi");
const { Environments, IssueStatus, Severity } = require("../utils/constants");

const objectId = Joi.string().hex().length(24);

// Shared pagination fields. Note: page/limit are already safe against
// operator injection today (parsePagination runs Number.parseInt on the
// value, which coerces an object to NaN and throws a 400) - these schemas
// are included for defense-in-depth and to keep validation centralized
// rather than scattered across the controller.
const page = Joi.number().integer().min(1);
const limit = Joi.number().integer().min(1);

// These are the actual injection sink: buildIssueFilter/buildPerformanceFilter
// in issue-controller.js previously copied these query values straight into
// a Mongoose filter object with no type check, so `?release[$gt]=` would
// arrive as `{ $gt: "" }` instead of a string. Typing them as Joi.string()
// rejects anything that isn't a plain string before it ever reaches Mongo.
const release = Joi.string().trim().max(200);
const errorName = Joi.string().trim().max(500);
const search = Joi.string().trim().max(200);

const dateFrom = Joi.string().isoDate();
const dateTo = Joi.string().isoDate();

const listIssuesQuery = Joi.object({
  page,
  limit,
  projectId: objectId,
  status: Joi.string().valid(...Object.values(IssueStatus)),
  severity: Joi.string().valid(...Object.values(Severity)),
  environment: Joi.string().valid(...Object.values(Environments)),
  release,
  errorName,
  dateFrom,
  dateTo,
  search,
  sortBy: Joi.string().valid(
    "lastSeen",
    "firstSeen",
    "occurrenceCount",
    "createdAt",
    "severity",
  ),
  order: Joi.string().valid("asc", "desc"),
}).unknown(false);

const performanceQuery = Joi.object({
  page,
  limit,
  projectId: objectId,
  environment: Joi.string().valid(...Object.values(Environments)),
  release,
  dateFrom,
  dateTo,
  slowThresholdMs: Joi.number().min(0),
}).unknown(false);

module.exports = {
  listIssues: { query: listIssuesQuery },
  listPerformanceEndpoints: { query: performanceQuery },
  getEndpointPerformance: { query: performanceQuery },
  getEndpointTrends: { query: performanceQuery },
  getTrace: { query: performanceQuery },
};
