const mongoose = require("mongoose");
const {
  DefaultEnvironment,
  ProjectEnvironments,
  ProjectStatus,
} = require("../utils/constants");

const dsnCacheSchema = new mongoose.Schema(
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
    dsnPublicKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(ProjectStatus),
      default: ProjectStatus.ACTIVE,
      index: true,
    },
    environment: {
      type: String,
      enum: Object.values(ProjectEnvironments),
      default: DefaultEnvironment,
      trim: true,
      lowercase: true,
    },
    lastSyncedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

dsnCacheSchema.index({ projectId: 1, dsnPublicKey: 1 }, { unique: true });
dsnCacheSchema.index({ projectId: 1 });
dsnCacheSchema.index({ status: 1 });

module.exports = mongoose.model("DsnCache", dsnCacheSchema);
