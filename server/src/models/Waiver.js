import mongoose from "mongoose";

const waiverSchema = new mongoose.Schema(
  {
    qrToken: { type: String, default: null, select: true },
    qrUrl: { type: String, default: "" },
    additionalActivities: [{
      attractionId: { type: mongoose.Schema.Types.ObjectId, ref: "Attraction", required: true },
      attractionName: { type: String, required: true },
      status: { type: String, enum: ["pending", "approved", "rejected", "revoked"], default: "pending" },
      requestedAt: { type: Date, default: Date.now },
      validatedAt: { type: Date, default: null },
      validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      review: { decision: String, comment: String, reviewedAt: Date, reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" } },
      schedule: { date: String, time: String, group: String, assignedAt: Date, assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" } }
    }],
    attractionId: { type: mongoose.Schema.Types.ObjectId, ref: "Attraction", required: true },
    attractionName: { type: String, required: true },
    attractionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Attraction" }],
    attractionNames: [{ type: String, trim: true }],
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
      height: { type: Number, min: 0, default: null },
      weight: { type: Number, min: 0, default: null },
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
    visitDate: { type: String, default: null },
    // First real Staff assignment; API corrections never overwrite these fields.
    scheduleAssignedAt: { type: Date, default: null },
    qrExpiresAt: { type: Date, default: null },
    // Scheduled visit instant (kept separate from the activation timestamp).
    assignedAt: { type: Date, default: null },
    validatedAt: { type: Date, default: null },
    validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    review: {
      decision: {
        type: String,
        enum: ["approved", "rejected", null],
        default: null
      },
      comment: { type: String, trim: true, default: "" },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      reviewedAt: { type: Date, default: null }
    },

    safetyVerification: {
      weightDeclared: { type: Number, min: 0, default: null },
      weightVerified: { type: Number, min: 0, default: null },
      weightStatus: { type: String, enum: ["not_required", "pending", "within_range", "outside_range"], default: "pending" },
      comments: { type: String, trim: true, default: "" },
      checkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      checkedAt: { type: Date, default: null }
    },

    qrConsumedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    schedule: {
      date: { type: String, trim: true, default: "" },
      group: { type: String, trim: true, default: "" },
      attractionId: { type: mongoose.Schema.Types.ObjectId, ref: "Attraction", default: null },
      attractionName: { type: String, trim: true, default: "" },
      time: { type: String, trim: true, default: "" },
      assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      assignedAt: { type: Date, default: null }
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "revoked"],
      default: "pending"
    }
  },
  { timestamps: true }
);

waiverSchema.index({ createdAt: -1 });
waiverSchema.index({ attractionId: 1, createdAt: -1 });
waiverSchema.index({ status: 1, createdAt: -1 });

export const Waiver = mongoose.model("Waiver", waiverSchema);
