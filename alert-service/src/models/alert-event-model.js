const mongoose = require("mongoose");
const { AlertState, NotificationActionType, NotificationDeliveryStatus } = require("../utils/constants");

// History is naturally time-bounded (a firing/resolve record), so it gets a
// TTL index from the start - matches the lesson from Module 1
// (RefreshToken missed this originally) and Module 8's CheckIn/UptimeCheck
// (which got it right from the start).
const ALERT_EVENT_TTL_SECONDS = Number.parseInt(
  process.env.ALERT_EVENT_TTL_SECONDS || `${90 * 24 * 60 * 60}`,
  10,
);

const notificationResultSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.values(NotificationActionType), required: true },
    target: { type: String, required: true },
    status: { type: String, enum: Object.values(NotificationDeliveryStatus), required: true },
    error: { type: String, default: null },
  },
  { _id: false },
);

const alertEventSchema = new mongoose.Schema({
  ruleId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  projectId: { type: mongoose.Schema.Types.ObjectId },
  ruleName: { type: String, required: true },
  fromState: { type: String, enum: Object.values(AlertState), required: true },
  toState: { type: String, enum: Object.values(AlertState), required: true },
  value: { type: Number, required: true },
  thresholdCrossed: { type: Number, default: null },
  notifications: { type: [notificationResultSchema], default: [] },
  triggeredAt: { type: Date, default: Date.now, index: true },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + ALERT_EVENT_TTL_SECONDS * 1000),
    index: { expires: 0 },
  },
});

alertEventSchema.index({ ruleId: 1, triggeredAt: -1 });

const AlertEvent = mongoose.model("AlertEvent", alertEventSchema);

module.exports = { AlertEvent, ALERT_EVENT_TTL_SECONDS };
