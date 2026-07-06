const mongoose = require("mongoose");
const {
  Environments,
  IssueStatus,
  ProcessingStatus,
  Severity,
} = require("../utils/constants");

const mixedContextSchema = new mongoose.Schema({}, { _id: false, strict: false });

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

const Issue = mongoose.model("Issue", issueSchema);
const IssueEvent = mongoose.model("IssueEvent", issueEventSchema);
const ProcessedOccurrence = mongoose.model(
  "ProcessedOccurrence",
  processedOccurrenceSchema,
);

module.exports = {
  Issue,
  IssueEvent,
  ProcessedOccurrence,
};
