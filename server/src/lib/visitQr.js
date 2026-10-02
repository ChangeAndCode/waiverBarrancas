import { activitySummaries } from "./additionalActivities.js";
import { waiverDisplayId } from "./folio.js";
import { getWaiverQrExpiresAt, isWaiverQrExpired } from "./waiverValidity.js";

export function visitQrResult(waiver, now = new Date()) {
  const expiresAt = getWaiverQrExpiresAt(waiver);
  if (isWaiverQrExpired(waiver, now)) {
    return { valid: false, reason: "qr_expired", expiresAt,
      signedAt: waiver.createdAt, fullName: waiver.participant.fullName,
      attractionName: waiver.attractionName };
  }
  return {
    valid: true,
    accessAuthorized: !(waiver.additionalActivities || []).length && waiver.status === "approved" && Boolean(waiver.assignedAt),
    originalAccessAuthorized: waiver.status === "approved" && Boolean(waiver.assignedAt),
    additionalActivities: activitySummaries(waiver),
    waiver: {
      id: waiverDisplayId(waiver), fullName: waiver.participant.fullName,
      attractionName: waiver.attractionName, birthDate: waiver.participant.birthDate,
      signedAt: waiver.createdAt, status: waiver.status, visitDate: waiver.visitDate,
      assignedAt: waiver.assignedAt, validatedAt: waiver.validatedAt, expiresAt
    }
  };
}
