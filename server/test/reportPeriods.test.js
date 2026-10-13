import test from 'node:test';
import assert from 'node:assert/strict';
import { reportPeriod, periodBuckets } from '../../shared/reportPeriods.js';
import { waiverAdminReportFilter } from '../src/lib/waiverReportFilters.js';
test('calendar periods in Chihuahua, leap years and exclusive midnight', () => {
  assert.equal(reportPeriod('day', '2026-10-09').start.toISOString(), '2026-10-09T06:00:00.000Z');
  assert.equal(reportPeriod('week', '2027-01-01').from, '2026-12-28');
  assert.equal(reportPeriod('week', '2027-01-03').to, '2027-01-03');
  assert.equal(reportPeriod('month', '2024-02-20').to, '2024-02-29');
  assert.equal(periodBuckets(reportPeriod('month', '2024-02-20')).length, 29);
  assert.equal(periodBuckets(reportPeriod('year', '2026-10-09')).length, 12);
  assert.equal(periodBuckets(reportPeriod('day', '2026-10-09')).length, 24);
  for (const day of ['2026-02-30', 'invalid', '2026-13-01']) assert.throws(() => reportPeriod('day', day));
  assert.throws(() => reportPeriod('quarter', '2026-10-09'));
  const filter = waiverAdminReportFilter({ query: { from: '2026-10-09', to: '2026-10-09' } });
  assert.equal(filter.createdAt.$lt.toISOString(), '2026-10-10T06:00:00.000Z');
  assert.throws(() => waiverAdminReportFilter({ query: { from: '2026-10-10', to: '2026-10-09' } }));
  assert.throws(() => waiverAdminReportFilter({ query: { attractionId: 'bad' } }));
});
test('historical DST hourly buckets cover every instant without duplicate keys', () => {
  const period = reportPeriod('day', '2021-10-31');
  const buckets = periodBuckets(period);
  assert.equal(buckets.length, 25);
  assert.equal(new Set(buckets.map(b => b.key)).size, 25);
  assert.deepEqual(buckets.at(-1).end, period.end);
});
