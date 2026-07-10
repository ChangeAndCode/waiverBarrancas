export const WAIVER_QR_VALIDITY_MS = 72 * 60 * 60 * 1000;

export function getWaiverQrExpiresAt(createdAt) {
  const signedAt = new Date(createdAt);
  if (Number.isNaN(signedAt.getTime())) return null;
  return new Date(signedAt.getTime() + WAIVER_QR_VALIDITY_MS);
}

export function isWaiverQrExpired(waiver, now = new Date()) {
  const expiresAt = getWaiverQrExpiresAt(waiver?.createdAt);
  if (!expiresAt) return true;
  return now.getTime() >= expiresAt.getTime();
}
