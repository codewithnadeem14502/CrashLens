const mongoose = require("mongoose");
const {
  DefaultEnvironment,
  ProjectEnvironments,
  ProjectStatus,
} = require("../utils/constants");

const projectSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 140,
    },
    dsn: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    dsnPublicKey: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    environment: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      enum: Object.values(ProjectEnvironments),
      maxlength: 80,
      default: DefaultEnvironment,
    },
    status: {
      type: String,
      enum: Object.values(ProjectStatus),
      default: ProjectStatus.ACTIVE,
      index: true,
    },
    settings: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    archivedAt: {
      type: Date,
    },
    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  { timestamps: true },
);

projectSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
projectSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Project", projectSchema);
