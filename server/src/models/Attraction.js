import mongoose from "mongoose";
import { defaultWaiverTextMx2026 } from "../lib/waiverText.js";

const attractionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "", trim: true },
    waiverText: { type: String, default: defaultWaiverTextMx2026 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const Attraction = mongoose.model("Attraction", attractionSchema);
