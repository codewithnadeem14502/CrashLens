const mongoose = require("mongoose");
const { ProcessingStatus } = require("../utils/constants");

const processedEventSchema = new mongoose.Schema(
  {
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
    status: {
      type: String,
      enum: Object.values(ProcessingStatus),
      required: true,
      default: ProcessingStatus.PROCESSING,
      index: true,
    },
    fingerprint: {
      type: String,
      trim: true,
      index: true,
    },
    outputEventId: {
      type: String,
      trim: true,
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

module.exports = mongoose.model("ProcessedEvent", processedEventSchema);
