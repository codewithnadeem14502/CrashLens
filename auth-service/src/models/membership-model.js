const mongoose = require("mongoose");
const { MembershipStatus, Roles } = require("../utils/constants");

const membershipSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(Roles),
      required: true,
      default: Roles.ADMIN,
    },
    status: {
      type: String,
      enum: Object.values(MembershipStatus),
      default: MembershipStatus.ACTIVE,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

membershipSchema.index(
  { organizationId: 1, userId: 1 },
  { unique: true },
);

module.exports = mongoose.model("Membership", membershipSchema);
