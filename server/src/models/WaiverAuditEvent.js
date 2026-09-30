import mongoose from "mongoose";

const waiverAuditEventSchema = new mongoose.Schema(
  {
    waiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Waiver",
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true
    },
    userRole: {
      type: String,
      enum: ["admin", "staff", null],
      default: null,
      index: true
    },
    action: {
      type: String,
      enum: [
        "waiver_created",
        "qr_generated",
        "qr_validated",
        "comment_added",
        "approved",
        "rejected",
        "revoked",
        "status_changed"
        ,"schedule_assigned"
        ,"ticket_printed"
      ],
      required: true,
      index: true
    },
    comment: { type: String, trim: true, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

waiverAuditEventSchema.index({ waiverId: 1, createdAt: -1 });

export const WaiverAuditEvent = mongoose.model("WaiverAuditEvent", waiverAuditEventSchema);
