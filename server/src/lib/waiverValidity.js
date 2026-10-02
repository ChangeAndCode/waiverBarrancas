import { visitQrExpiresAt, parkDate, parkDateTime, addCalendarDays } from "../../../shared/visitSchedule.js";

export const WAIVER_QR_VALIDITY_MS = 72 * 60 * 60 * 1000;

export function getWaiverQrExpiresAt(waiver) {
  if (waiver?.qrExpiresAt) return new Date(waiver.qrExpiresAt);
  if (waiver?.scheduleAssignedAt) return visitQrExpiresAt(waiver.scheduleAssignedAt);
  // Historical visits retain their old boundary without inventing an assignment instant.
  if (waiver?.visitDate) {
    if (!waiver.assignedAt) return null;
    const assigned = new Date(waiver.assignedAt);
    return Number.isFinite(assigned.getTime()) ? parkDateTime(addCalendarDays(parkDate(assigned), 2)) : null;
  }
  const signedAt = new Date(waiver?.createdAt ?? waiver);
  if (Number.isNaN(signedAt.getTime())) return null;
  return new Date(signedAt.getTime() + WAIVER_QR_VALIDITY_MS);
}

export function isWaiverQrExpired(waiver, now = new Date()) {
  const expiresAt = getWaiverQrExpiresAt(waiver);
  if (!expiresAt) return !waiver?.visitDate;
  return !Number.isFinite(expiresAt.getTime()) || now.getTime() >= expiresAt.getTime();
}

// Evaluate at database execution time, not at the earlier application read.
export function qrWriteGuard(waiver) {
  const expiresAt = getWaiverQrExpiresAt(waiver);
  return {
    deletedAt: null,
    scheduleAssignedAt: waiver.scheduleAssignedAt || null,
    qrExpiresAt: waiver.qrExpiresAt || null,
    ...(expiresAt ? { $expr: { $gt: [{ $literal: expiresAt }, "$$NOW"] } } : {})
  };
}

export function originalAccessAuthorized(waiver, now = new Date()) {
  return Boolean(waiver && !waiver.deletedAt && waiver.status === "approved" &&
    waiver.assignedAt && (!waiver.scheduleAssignedAt || waiver.validatedAt) && !isWaiverQrExpired(waiver, now));
}
