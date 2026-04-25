import mongoose from "mongoose";

const waiverDraftSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true }
  },
  { timestamps: true }
);

waiverDraftSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 48 });

export const WaiverDraft = mongoose.model("WaiverDraft", waiverDraftSchema);
