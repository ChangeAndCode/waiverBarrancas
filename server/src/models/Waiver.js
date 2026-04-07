import mongoose from "mongoose";

const waiverSchema = new mongoose.Schema(
  {
    attractionId: { type: mongoose.Schema.Types.ObjectId, ref: "Attraction", required: true },
    attractionName: { type: String, required: true },
    participant: {
      fullName: { type: String, required: true, trim: true },
      birthDate: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true },
      emergencyContact: { type: String, required: true, trim: true }
    },
    answers: {
      hasMedicalCondition: { type: Boolean, required: true },
      consumedAlcoholOrDrugs: { type: Boolean, required: true },
      acceptsSafetyRules: { type: Boolean, required: true }
    },
    acceptedText: { type: Boolean, required: true },
    signatureName: { type: String, required: true, trim: true },
    signatureImage: { type: String, required: true },
    waiverTextSnapshot: { type: String, required: true },
    status: { type: String, enum: ["signed", "revoked"], default: "signed" }
  },
  { timestamps: true }
);

export const Waiver = mongoose.model("Waiver", waiverSchema);
