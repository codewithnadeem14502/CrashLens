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

// Standalone unique index: a dsnPublicKey must never be shared by two
// projects, not just be unique per-project. The compound index above only
// enforces uniqueness of the (projectId, dsnPublicKey) pair; this closes
// the gap where the same key could otherwise be cached under two different
// projectIds.
dsnCacheSchema.index({ dsnPublicKey: 1 }, { unique: true });

// TTL fallback: self-evict cache entries that haven't been touched by a
// project lifecycle event (create/update/archive/dsn-regenerate - see
// project-event-consumer.js) within DSN_CACHE_TTL_SECONDS. This bounds how
// long a revoked/regenerated DSN can keep validating if the RabbitMQ
// consumer that's supposed to process the "dsn.regenerated" event is down
// or backlogged - without this, that window is unbounded.
//
// Known accepted tradeoff: lastSyncedAt is only refreshed by a lifecycle
// event, not on every successful validation hit. A project that is active
// and simply never changes (no update/regenerate) for the full TTL window
// will fall out of the cache and start getting its ingestion requests
// rejected (401) until the next lifecycle event re-syncs it. The default
// TTL is set generously (30 days) to make this rare in practice; tune via
// DSN_CACHE_TTL_SECONDS if your deployment needs a tighter revocation
// window or sees longer stretches of untouched-but-active projects.
const DSN_CACHE_TTL_SECONDS = Number.parseInt(
  process.env.DSN_CACHE_TTL_SECONDS || `${30 * 24 * 60 * 60}`,
  10,
);
dsnCacheSchema.index(
  { lastSyncedAt: 1 },
  { expireAfterSeconds: DSN_CACHE_TTL_SECONDS },
);

module.exports = mongoose.model("DsnCache", dsnCacheSchema);
