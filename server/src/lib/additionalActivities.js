import { getWaiverQrExpiresAt, isWaiverQrExpired } from './waiverValidity.js';
import { parkDate, parkDateTime } from '../../../shared/visitSchedule.js';

export function eligibleForAdditional(waiver, now = new Date()) {
  return Boolean(waiver?.visitDate && !waiver.deletedAt &&
    !['rejected', 'revoked'].includes(waiver.status) && (!waiver.scheduleAssignedAt || (waiver.status === 'approved' && waiver.validatedAt)) && !isWaiverQrExpired(waiver, now) &&
    (waiver.assignedAt || waiver.visitDate >= parkDate(now)));
}
export function additionalAuthorized(waiver, activity, now = new Date()) {
  const instant = parkDateTime(activity?.schedule?.date, activity?.schedule?.time);
  const expiry = getWaiverQrExpiresAt(waiver);
  return Boolean(eligibleForAdditional(waiver, now) && waiver.status === 'approved' &&
    activity?.status === 'approved' && activity.validatedAt && instant && expiry && instant >= parkDateTime(waiver.visitDate) && instant < expiry);
}
export function activitySummaries(waiver, now = new Date()) {
  return (waiver.additionalActivities || []).map(a => ({
    id: String(a._id), attractionId: String(a.attractionId), attractionName: a.attractionName,
    status: a.status, schedule: a.schedule, review: a.review,
    accessAuthorized: additionalAuthorized(waiver, a, now)
  }));
}
