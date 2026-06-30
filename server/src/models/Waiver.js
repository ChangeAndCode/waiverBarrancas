import mongoose from "mongoose";

const waiverSchema = new mongoose.Schema(
  {
    attractionId: { type: mongoose.Schema.Types.ObjectId, ref: "Attraction", required: true },
    attractionName: { type: String, required: true },
    folio: { type: String, trim: true, unique: true, sparse: true },
    participant: {
      fullName: { type: String, required: true, trim: true },
      birthDate: { type: String, required: true, trim: true },
      gender: { type: String, enum: ["masculino", "femenino"], required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true },
      emergencyContactName: { type: String, required: true, trim: true },
      emergencyContactPhone: { type: String, required: true, trim: true },
      nationality: { type: String, trim: true, default: "" },
      cityState: { type: String, trim: true, default: "" },
      medications: { type: String, trim: true, default: "" },
      treatingPhysician: { type: String, trim: true, default: "" },
      physicianPhone: { type: String, trim: true, default: "" },
      emergencyContactRelationship: { type: String, trim: true, default: "" },
      familyReference2Name: { type: String, trim: true, default: "" },
      familyReference2Relationship: { type: String, trim: true, default: "" },
      familyReference2Phone: { type: String, trim: true, default: "" }
    },
    isMinor: { type: Boolean, default: false },
    guardian: {
      fullName: { type: String, trim: true, default: "" },
      relation: { type: String, trim: true, default: "" },
      phone: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, default: "" },
      signatureImage: { type: String, default: "" }
    },
    answers: {
      hasMedicalCondition: { type: Boolean, required: true },
      consumedAlcoholOrDrugs: { type: Boolean, required: true },
      acceptsSafetyRules: { type: Boolean, required: true }
    },
    acceptedText: { type: Boolean, required: true },
    signatureName: { type: String, required: true, trim: true },
    signatureImage: { type: String, required: true },
    witness: {
      signatureImage: { type: String, default: "" }
    },
    waiverTextSnapshot: { type: String, required: true },
    /** Primera validación por staff (GET /reports/validate); el QR deja de ser válido después. */
    qrConsumedAt: { type: Date, default: null },
    status: { type: String, enum: ["signed", "revoked"], default: "signed" }
  },
  { timestamps: true }
);

waiverSchema.index({ createdAt: -1 });
waiverSchema.index({ attractionId: 1, createdAt: -1 });
waiverSchema.index({ status: 1, createdAt: -1 });

export const Waiver = mongoose.model("Waiver", waiverSchema);
