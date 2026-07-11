const mongoose = require("mongoose");
const { Dataset, Aggregate } = require("../utils/constants");

// The one query shape shared by dashboard widgets and alert rules - "one
// generic, parameterized query executor... rather than one-off queries per
// widget type" per the module brief. Both Dashboard.widgets[].query and
// AlertRule.query embed this exact subschema, and query/query-executor.js
// is the single place that interprets it. Filters are a flat, explicitly
// typed bag (never a raw passthrough of client input into a downstream
// filter) - each field here is mirrored verbatim into the dateFrom/
// dateTo/status/severity/etc. query params issue-service and monitor-
// service already validate on their own end.
const queryFiltersSchema = new mongoose.Schema(
  {
    projectId: { type: String, trim: true, maxlength: 64 },
    environment: { type: String, trim: true, maxlength: 32 },
    severity: { type: String, trim: true, maxlength: 32 },
    status: { type: String, trim: true, maxlength: 32 },
    release: { type: String, trim: true, maxlength: 200 },
    errorName: { type: String, trim: true, maxlength: 200 },
    level: { type: String, trim: true, maxlength: 32 },
    endpointId: { type: String, trim: true, maxlength: 64 },
    search: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false },
);

const queryDefinitionSchema = new mongoose.Schema(
  {
    dataset: { type: String, enum: Object.values(Dataset), required: true },
    aggregate: { type: String, enum: Object.values(Aggregate), required: true },
    filters: { type: queryFiltersSchema, default: () => ({}) },
    // Rolling window ending "now", in minutes. Capped at 30 days - matches
    // the spirit of issue-service's own MAX_PERFORMANCE_ROWS bound: this
    // service reads through existing list/paginate endpoints, so an
    // unbounded window risks the same kind of unbounded in-memory work
    // issue-service already caps for performance transactions.
    timeWindowMinutes: { type: Number, required: true, min: 1, max: 43200 },
  },
  { _id: false },
);

module.exports = { queryDefinitionSchema, queryFiltersSchema };
