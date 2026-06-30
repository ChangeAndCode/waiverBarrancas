import mongoose from "mongoose";

const folioCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 }
});

export const FolioCounter = mongoose.model("FolioCounter", folioCounterSchema);
