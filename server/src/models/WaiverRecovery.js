import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  codeHash: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null }
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const WaiverRecovery = mongoose.model('WaiverRecovery', schema);
