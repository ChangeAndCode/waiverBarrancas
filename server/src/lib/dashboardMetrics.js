import { Waiver } from '../models/Waiver.js';
import { Attraction } from '../models/Attraction.js';
import { reportPeriod, periodBuckets, ReportInputError, PARK_TIME_ZONE } from '../../../shared/reportPeriods.js';
import { parkDate } from '../../../shared/visitSchedule.js';
import { waiverAdminReportFilter, originalAttractionsExpression } from './waiverReportFilters.js';
import { provenanceExpression } from './reportProvenance.js';
const count = filter => [{ $match: filter }, { $count: 'count' }];
const statusExpression = { $switch: { branches: [
  { case: { $in: ['$status', ['pending', 'signed']] }, then: 'pending' },
  ...['approved', 'rejected', 'revoked'].map(status => ({ case: { $eq: ['$status', status] }, then: status }))
], default: 'other' } };
export async function dashboardMetrics(input = {}, now = new Date()) {
  if (['from', 'to', 'until'].some(key => input[key])) throw new ReportInputError('Selecciona granularity y anchor para el periodo de métricas.');
  const selected = reportPeriod(input.granularity || 'month', input.anchor || parkDate(now));
  const buckets = periodBuckets(selected);
  const base = waiverAdminReportFilter({ query: input }, now);
  const selectedFilter = { ...base, createdAt: { $gte: selected.start, $lt: selected.end } };
  const current = Object.fromEntries(['day', 'week', 'month', 'year'].map(unit => [unit, reportPeriod(unit, parkDate(now))]));
  // Top cards always count all available letters in current periods, independent of selected filters.
  const facets = {
    historical: [{ $count: 'count' }],
    ...Object.fromEntries(Object.entries(current).map(([unit, p]) => [unit, count({ createdAt: { $gte: p.start, $lt: p.end } })])),
    selected: count(selectedFilter),
    series: [{ $match: selectedFilter }, { $bucket: { groupBy: '$createdAt', boundaries: [...buckets.map(b => b.start), selected.end], output: { count: { $sum: 1 } } } }],
    states: [{ $match: selectedFilter }, { $group: { _id: statusExpression, count: { $sum: 1 } } }],
    attractions: [{ $match: selectedFilter }, { $project: { ids: originalAttractionsExpression } }, { $unwind: { path: '$ids', preserveNullAndEmptyArrays: true } }, { $group: { _id: { $ifNull: ['$ids', null] }, count: { $sum: 1 } } }],
    provenance: [{ $match: selectedFilter }, { $group: { _id: provenanceExpression(), count: { $sum: 1 } } }]
  };
  const [result] = await Waiver.aggregate([{ $match: { deletedAt: null } }, { $facet: facets }]);
  const catalog = await Attraction.find().select('_id name').lean();
  const names = new Map(catalog.map(a => [String(a._id), a.name]));
  const total = result.selected[0]?.count || 0;
  const decorate = (rows, field) => rows.map(row => ({ [field]: row._id, count: row.count, percentage: total ? row.count * 100 / total : 0 }));
  return {
    timeZone: PARK_TIME_ZONE, generatedAt: now, period: selected,
    filters: { ...input, from: selected.from, to: selected.to },
    historicalTotal: result.historical[0]?.count || 0,
    current: Object.fromEntries(Object.entries(current).map(([unit, period]) => [unit, { ...period, total: result[unit][0]?.count || 0 }])),
    total,
    series: buckets.map(bucket => ({ ...bucket, count: result.series.find(r => new Date(r._id).getTime() === bucket.start.getTime())?.count || 0 })),
    states: ['pending', 'approved', 'rejected', 'revoked', 'other'].map(status => ({ status, count: result.states.find(r => r._id === status)?.count || 0 })).map(row => ({ ...row, percentage: total ? row.count * 100 / total : 0 })),
    attractions: decorate(result.attractions, 'attractionId').map(row => ({ ...row, name: row.attractionId ? names.get(String(row.attractionId)) || 'Atracción fuera del catálogo' : 'Sin atracción asociada' })),
    provenance: decorate(result.provenance, 'category')
  };
}
