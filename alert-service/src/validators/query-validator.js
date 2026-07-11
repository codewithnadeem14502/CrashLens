const Joi = require("joi");
const { Dataset, Aggregate, DATASET_AGGREGATES } = require("../utils/constants");

// The one query shape shared by dashboard widgets and alert rules - kept
// as a single reusable Joi fragment (models/query-definition-schema.js is
// its mongoose-side counterpart) rather than duplicated per resource.
// Every filter field is explicitly typed and bounded; `.unknown(false)`
// (the schema's default) rejects anything not listed here before it can
// reach the query executor's filter-passthrough into issue-service/
// monitor-service's own query params.
const queryFiltersSchema = Joi.object({
  projectId: Joi.string().hex().length(24),
  environment: Joi.string().max(32),
  severity: Joi.string().max(32),
  status: Joi.string().max(32),
  release: Joi.string().max(200),
  errorName: Joi.string().max(200),
  level: Joi.string().max(32),
  endpointId: Joi.string().max(64),
  search: Joi.string().max(200),
});

const queryDefinitionSchema = Joi.object({
  dataset: Joi.string()
    .valid(...Object.values(Dataset))
    .required(),
  aggregate: Joi.string()
    .valid(...Object.values(Aggregate))
    .required(),
  filters: queryFiltersSchema.default({}),
  timeWindowMinutes: Joi.number().integer().min(1).max(43200).required(),
}).custom((value, helpers) => {
  const allowed = DATASET_AGGREGATES[value.dataset] || [];

  if (!allowed.includes(value.aggregate)) {
    return helpers.message(
      `aggregate "${value.aggregate}" is not valid for dataset "${value.dataset}" (allowed: ${allowed.join(", ")})`,
    );
  }

  return value;
}, "dataset/aggregate compatibility");

module.exports = { queryDefinitionSchema, queryFiltersSchema };
