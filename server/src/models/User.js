import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "staff", "taquilla"], required: true },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    authVersion: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
