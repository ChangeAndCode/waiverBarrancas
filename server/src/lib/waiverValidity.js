import { visitQrExpiresAt } from "../../../shared/visitSchedule.js";

export const WAIVER_QR_VALIDITY_MS = 72 * 60 * 60 * 1000;

export function getWaiverQrExpiresAt(waiver) {
  if (waiver?.visitDate) return visitQrExpiresAt(waiver.assignedAt);
  const signedAt = new Date(waiver?.createdAt ?? waiver);
  if (Number.isNaN(signedAt.getTime())) return null;
  return new Date(signedAt.getTime() + WAIVER_QR_VALIDITY_MS);
}

export function isWaiverQrExpired(waiver, now = new Date()) {
  const expiresAt = getWaiverQrExpiresAt(waiver);
  if (!expiresAt) return !waiver?.visitDate;
  return now.getTime() >= expiresAt.getTime();
}
