const mongoose = require("mongoose");
const { queryDefinitionSchema } = require("./query-definition-schema");

// Bounded, not a top-level collection: a dashboard's widgets are always
// read/edited together (the widget builder saves the whole array at once),
// and the count is naturally small - capped explicitly here rather than
// left unbounded, to not repeat the PerformanceTransaction.spans mistake
// flagged in production-readiness-checklist.md ("no unbounded embedded
// arrays"). A widget's *current value* is never stored - it's computed on
// read by calling the same query executor a rule uses (see
// query/query-executor.js), so a dashboard document is pure config.
const MAX_WIDGETS_PER_DASHBOARD = 30;

const widgetSchema = new mongoose.Schema(
  {
    widgetId: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    // "stat" is the only widget rendering this module builds: the query
    // executor returns one aggregate value per call, not a time-bucketed
    // series, so a real line/bar chart has nothing to plot yet. Kept as an
    // enum (not hardcoded) so a future time-series query mode can add
    // "line"/"bar" here without a migration.
    chartType: { type: String, enum: ["stat"], default: "stat" },
    query: { type: queryDefinitionSchema, required: true },
    layout: {
      x: { type: Number, default: 0, min: 0 },
      y: { type: Number, default: 0, min: 0 },
      w: { type: Number, default: 4, min: 1, max: 12 },
      h: { type: Number, default: 3, min: 1, max: 12 },
    },
  },
  { _id: false },
);

const dashboardSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    projectId: { type: mongoose.Schema.Types.ObjectId, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    widgets: {
      type: [widgetSchema],
      default: [],
      validate: {
        validator: (widgets) => widgets.length <= MAX_WIDGETS_PER_DASHBOARD,
        message: `A dashboard cannot have more than ${MAX_WIDGETS_PER_DASHBOARD} widgets`,
      },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

dashboardSchema.index({ organizationId: 1, createdAt: -1 });

const Dashboard = mongoose.model("Dashboard", dashboardSchema);

module.exports = { Dashboard, MAX_WIDGETS_PER_DASHBOARD };
