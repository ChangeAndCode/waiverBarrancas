import { provenanceExpression, PROVENANCE_CATEGORIES } from './reportProvenance.js';
import mongoose from 'mongoose';
import { parkDate, parkDateTime, addCalendarDays } from '../../../shared/visitSchedule.js';
import { ReportInputError, validReportDay } from '../../../shared/reportPeriods.js';
export const originalAttractionsExpression = {
  $filter: { input: { $setUnion: [{ $cond: [{ $gt: [{ $size: { $ifNull: ['$attractionIds', []] } }, 0] }, '$attractionIds', { $cond: [{ $ne: [{ $ifNull: ['$attractionId', null] }, null] }, ['$attractionId'], []] }] }, []] }, as: 'id', cond: { $ne: ['$$id', null] } }
};
export function waiverAdminReportFilter({ query: input }, now = new Date()) {
  const query = { deletedAt: null };
  if (input.attractionId) {
    if (!/^[a-f\d]{24}$/i.test(String(input.attractionId))) throw new ReportInputError('Atracción inválida.');
    query.$expr = { $in: [new mongoose.Types.ObjectId(String(input.attractionId)), originalAttractionsExpression] };
  }
  if (input.provenance) {
    if (!PROVENANCE_CATEGORIES.includes(input.provenance)) throw new ReportInputError('Procedencia inválida.');
    const expression = { $eq: [provenanceExpression(), input.provenance] };
    query.$expr = query.$expr ? { $and: [query.$expr, expression] } : expression;
  }
  if (input.attraction === 'none') {
    const expression = { $eq: [{ $size: originalAttractionsExpression }, 0] };
    query.$expr = query.$expr ? { $and: [query.$expr, expression] } : expression;
  }
  const status = String(input.status || '').trim();
  if (status && !['pending', 'approved', 'rejected', 'revoked', 'other'].includes(status)) throw new ReportInputError('Estado inválido.');
  if (status) query.status = status === 'pending' ? { $in: ['pending', 'signed'] } : status === 'other' ? { $nin: ['pending', 'signed', 'approved', 'rejected', 'revoked'] } : status;
  if (input.from || input.to) {
    query.createdAt = {};
    const instant = (value, upper) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        validReportDay(value);
        return parkDateTime(upper ? addCalendarDays(value, 1) : value);
      }
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new ReportInputError('Fecha inválida.');
      validReportDay(value.slice(0, 10));
      return new Date(value);
    };
    if (input.from) query.createdAt.$gte = instant(String(input.from), false);
    if (input.to) query.createdAt[/^\d{4}-\d{2}-\d{2}$/.test(input.to) ? '$lt' : '$lte'] = instant(String(input.to), true);
    if (input.until && input.to) throw new ReportInputError('No combines to y until.');
  }
  // Exact exclusive instants used when drilling down to an hourly bucket.
  if (input.until) {
    const end = new Date(input.until);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.until) || !Number.isFinite(end.getTime())) throw new ReportInputError('Límite inválido.');
    validReportDay(String(input.until).slice(0, 10));
    query.createdAt = { ...query.createdAt, $lt: end };
  }
  const range = query.createdAt;
  if (range?.$gte && (range.$lt || range.$lte) && range.$gte >= (range.$lt || range.$lte)) throw new ReportInputError('Rango inválido.');
  const period = String(input.period || '').trim();
  if (period && !['previous', 'active', 'upcoming'].includes(period)) throw new ReportInputError('Relación de visita inválida.');
  if (period === 'previous') query.visitDate = { $lt: parkDate(now) };
  if (period === 'active') query.visitDate = parkDate(now);
  if (period === 'upcoming') query.visitDate = { $gt: parkDate(now) };
  const q = String(input.q || '').trim();
  if (q) {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = ['participant.fullName', 'participant.email'].map(field => ({ [field]: { $regex: safe, $options: 'i' } }));
  }
  return query;
}
