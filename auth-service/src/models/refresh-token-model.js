const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    membershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Membership",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      // TTL index: MongoDB auto-deletes the document once this date is in
      // the past (expireAfterSeconds: 0 means "expire exactly at the date
      // stored in the field"). Without this, revoked/expired refresh
      // tokens accumulate in the collection forever.
      index: { expires: 0 },
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    replacedByTokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RefreshToken",
      default: null,
    },
    tokenFamilyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RefreshToken",
      default: null,
      index: true,
    },
    familyRevokedAt: {
      type: Date,
      default: null,
    },
    createdByIp: {
      type: String,
      default: null,
    },
    revokedByIp: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ userId: 1, organizationId: 1 });

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
