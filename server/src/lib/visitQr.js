import { activitySummaries } from "./additionalActivities.js";
import { waiverDisplayId } from "./folio.js";
import { getWaiverQrExpiresAt, isWaiverQrExpired, originalAccessAuthorized } from "./waiverValidity.js";

export function visitQrResult(waiver, now = new Date()) {
  const expiresAt = getWaiverQrExpiresAt(waiver);
  if (isWaiverQrExpired(waiver, now)) {
    return { valid: false, reason: "qr_expired", expiresAt,
      signedAt: waiver.createdAt, fullName: waiver.participant.fullName,
      attractionName: waiver.attractionName };
  }
  return {
    valid: true,
    accessAuthorized: !(waiver.additionalActivities || []).length && originalAccessAuthorized(waiver, now),
    originalAccessAuthorized: originalAccessAuthorized(waiver, now),
    additionalActivities: activitySummaries(waiver, now),
    waiver: {
      id: waiverDisplayId(waiver), fullName: waiver.participant.fullName,
      attractionName: waiver.attractionName, birthDate: waiver.participant.birthDate,
      signedAt: waiver.createdAt, status: waiver.status, visitDate: waiver.visitDate,
      assignedAt: waiver.assignedAt, scheduleAssignedAt: waiver.scheduleAssignedAt, validatedAt: waiver.validatedAt, expiresAt
    }
  };
}
