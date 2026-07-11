const mongoose = require("mongoose");
const {
  Environments,
  IssueStatus,
  LogLevel,
  ProcessingStatus,
  Severity,
} = require("../utils/constants");

const mixedContextSchema = new mongoose.Schema({}, { _id: false, strict: false });

// Confirmed P1 finding: PerformanceTransaction.spans was an unbounded
// embedded array of unbounded Mixed data (no cap here at all - only
// event-service's Joi schema capped spans at ingestion time, and even that
// only bounds item *count*, not each span's data size; the issue-service
// consumer never re-checked either, so a message crafted directly onto the
// queue could bypass the Joi cap entirely). These two limits bound the
// worst case at the model layer itself, the last line of defense
// regardless of how a document got here.
const MAX_TRANSACTION_SPANS = 200; // matches event-service's Joi spans.max(200)
const MAX_SPAN_DATA_BYTES = 2048;
// transaction.tags had no size cap anywhere in the pipeline (not even in
// event-service's Joi schema) - matches the SDK's own client-side
// TRACING_LIMITS.maxContextBytes, so both ends agree.
const MAX_TAGS_BYTES = 2048;

const issueSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    fingerprint: {
      type: String,
      required: true,
      trim: true,
    },
    fingerprintVersion: {
      type: String,
      default: "v1",
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    errorName: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    culprit: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    severity: {
      type: String,
      enum: Object.values(Severity),
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(IssueStatus),
      required: true,
      default: IssueStatus.UNRESOLVED,
      index: true,
    },
    occurrenceCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    firstSeen: {
      type: Date,
      required: true,
      index: true,
    },
    lastSeen: {
      type: Date,
      required: true,
      index: true,
    },
    lastRelease: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
    },
    lastEnvironment: {
      type: String,
      enum: Object.values(Environments),
      default: Environments.PRODUCTION,
      index: true,
    },
    regression: {
      type: Boolean,
      default: false,
      index: true,
    },
    resolvedAt: Date,
    resolvedBy: mongoose.Schema.Types.ObjectId,
    ignoredAt: Date,
    ignoredBy: mongoose.Schema.Types.ObjectId,
    reopenedAt: Date,
    reopenedBy: mongoose.Schema.Types.ObjectId,
  },
  { timestamps: true },
);

issueSchema.index(
  { organizationId: 1, projectId: 1, fingerprint: 1 },
  { unique: true },
);
issueSchema.index({ organizationId: 1, projectId: 1, status: 1, lastSeen: -1 });
issueSchema.index({ organizationId: 1, projectId: 1, severity: 1, lastSeen: -1 });
issueSchema.index({ title: "text", message: "text", errorName: "text", culprit: "text" });

const issueEventSchema = new mongoose.Schema(
  {
    issueId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    sourceEventId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    ingestionId: {
      type: String,
      trim: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    normalizedMessage: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    errorName: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    stackTrace: {
      type: String,
      maxlength: 50000,
    },
    topFrame: mixedContextSchema,
    request: mixedContextSchema,
    runtime: mixedContextSchema,
    server: mixedContextSchema,
    release: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
    },
    environment: {
      type: String,
      enum: Object.values(Environments),
      default: Environments.PRODUCTION,
      index: true,
    },
    severity: {
      type: String,
      enum: Object.values(Severity),
      required: true,
    },
    occurredAt: {
      type: Date,
      required: true,
      index: true,
    },
    receivedAt: Date,
    processedAt: Date,
    countedInIssue: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

issueEventSchema.index({ issueId: 1, occurredAt: -1 });
issueEventSchema.index({ organizationId: 1, projectId: 1, occurredAt: -1 });

const processedOccurrenceSchema = new mongoose.Schema(
  {
    sourceEventId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    issueId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(ProcessingStatus),
      required: true,
      default: ProcessingStatus.PROCESSING,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastError: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    processedAt: Date,
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

const transactionSpanSchema = new mongoose.Schema(
  {
    // maxlength matches event-service's Joi cap (spanId/parentSpanId both
    // max(200)) - these two were missed when data/op/description/status
    // got theirs, leaving them the only unbounded string fields on a span
    // besides data (which has its own separate byte-size validator below).
    spanId: { type: String, trim: true, maxlength: 200 },
    parentSpanId: { type: String, trim: true, maxlength: 200 },
    op: { type: String, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    startTimestamp: Date,
    endTimestamp: Date,
    durationMs: { type: Number, min: 0 },
    status: { type: String, trim: true, maxlength: 100 },
    data: mixedContextSchema,
  },
  { _id: false },
);

transactionSpanSchema.path("data").validate(function isWithinSizeLimit(value) {
  if (!value) {
    return true;
  }

  try {
    return JSON.stringify(value).length <= MAX_SPAN_DATA_BYTES;
  } catch {
    return false;
  }
}, `span data exceeds the maximum size of ${MAX_SPAN_DATA_BYTES} bytes`);

const performanceTransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    ingestionId: {
      type: String,
      trim: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    method: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 20,
    },
    route: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
    },
    url: {
      type: String,
      trim: true,
      maxlength: 2048,
    },
    durationMs: {
      type: Number,
      required: true,
      min: 0,
      index: true,
    },
    statusCode: {
      type: Number,
      required: true,
      min: 100,
      max: 599,
      index: true,
    },
    traceId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
    },
    spanId: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    spans: {
      type: [transactionSpanSchema],
      validate: {
        validator: (value) => !Array.isArray(value) || value.length <= MAX_TRANSACTION_SPANS,
        message: `spans array exceeds the maximum of ${MAX_TRANSACTION_SPANS} items`,
      },
    },
    tags: mixedContextSchema,
    release: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
    },
    environment: {
      type: String,
      enum: Object.values(Environments),
      default: Environments.PRODUCTION,
      index: true,
    },
    occurredAt: {
      type: Date,
      required: true,
      index: true,
    },
    receivedAt: Date,
    processedAt: Date,
  },
  { timestamps: true },
);

performanceTransactionSchema.path("tags").validate(function isWithinSizeLimit(value) {
  if (!value) {
    return true;
  }

  try {
    return JSON.stringify(value).length <= MAX_TAGS_BYTES;
  } catch {
    return false;
  }
}, `tags exceeds the maximum size of ${MAX_TAGS_BYTES} bytes`);

performanceTransactionSchema.index({
  organizationId: 1,
  projectId: 1,
  method: 1,
  route: 1,
  occurredAt: -1,
});
performanceTransactionSchema.index({
  organizationId: 1,
  projectId: 1,
  environment: 1,
  occurredAt: -1,
});

// Module 7 (Logs): kept in issue-service alongside Issue/PerformanceTransaction
// rather than a new service, consistent with how this service already owns
// the query-side for both. High-volume and naturally time-bounded like
// ProcessedEvent/ProcessedOccurrence - those got a TTL index from the start,
// don't repeat RefreshToken's original miss here (see production-readiness-
// checklist.md).
const LOG_ENTRY_TTL_SECONDS = Number.parseInt(
  process.env.LOG_ENTRY_TTL_SECONDS || `${30 * 24 * 60 * 60}`,
  10,
);
const MAX_LOG_CONTEXT_BYTES = 2048; // matches transaction.tags/span.data convention
const MAX_LOGS_PER_BATCH = 50; // matches event-service's Joi cap

const logEntrySchema = new mongoose.Schema(
  {
    // Assigned by event-service per log line at ingestion time (not by the
    // producer) so a RabbitMQ redelivery of the same batch message can be
    // upserted idempotently instead of inserting duplicate rows - the same
    // role transactionId/sourceEventId play for the other two collections.
    entryId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    batchId: {
      type: String,
      trim: true,
    },
    ingestionId: {
      type: String,
      trim: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    level: {
      type: String,
      enum: Object.values(LogLevel),
      required: true,
      index: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    logger: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    // Structurally present from day one, per the Module 7 scope decision -
    // correlation-ID propagation itself (populating this on the producer
    // side) is deferred to the Module 2 fast-follow, so this field mostly
    // won't be populated yet. Indexed anyway so trace/log click-through
    // works the moment a producer starts sending it, with no later
    // migration needed.
    traceId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
    },
    correlationId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
    },
    context: mixedContextSchema,
    release: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
    },
    environment: {
      type: String,
      enum: Object.values(Environments),
      default: Environments.PRODUCTION,
      index: true,
    },
    occurredAt: {
      type: Date,
      required: true,
      index: true,
    },
    receivedAt: Date,
    processedAt: Date,
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + LOG_ENTRY_TTL_SECONDS * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

logEntrySchema.path("context").validate(function isWithinSizeLimit(value) {
  if (!value) {
    return true;
  }

  try {
    return JSON.stringify(value).length <= MAX_LOG_CONTEXT_BYTES;
  } catch {
    return false;
  }
}, `context exceeds the maximum size of ${MAX_LOG_CONTEXT_BYTES} bytes`);

logEntrySchema.index({ organizationId: 1, projectId: 1, occurredAt: -1 });
logEntrySchema.index({
  organizationId: 1,
  projectId: 1,
  level: 1,
  occurredAt: -1,
});
logEntrySchema.index({ message: "text" });

const Issue = mongoose.model("Issue", issueSchema);
const IssueEvent = mongoose.model("IssueEvent", issueEventSchema);
const PerformanceTransaction = mongoose.model(
  "PerformanceTransaction",
  performanceTransactionSchema,
);
const ProcessedOccurrence = mongoose.model(
  "ProcessedOccurrence",
  processedOccurrenceSchema,
);
const LogEntry = mongoose.model("LogEntry", logEntrySchema);

module.exports = {
  Issue,
  IssueEvent,
  PerformanceTransaction,
  ProcessedOccurrence,
  LogEntry,
  MAX_TRANSACTION_SPANS,
  MAX_LOGS_PER_BATCH,
  MAX_LOG_CONTEXT_BYTES,
  LOG_ENTRY_TTL_SECONDS,
};
