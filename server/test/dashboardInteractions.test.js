import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetricsRefresh, metricReportFilters, metricsSelection } from '../../client/src/lib/dashboardInteractions.js';
import { reportPeriod } from '../../shared/reportPeriods.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
test('drilldown resets all filters and retains exact exclusive period bounds', () => {
  const period = reportPeriod('day', '2026-10-09');
  const data = { period };
  for (const kind of ['current', 'state', 'attraction', 'provenance', 'interval']) {
    const filters = metricReportFilters(data, kind, { ...period, status: 'pending', attractionId: 'id', category: 'Sin procedencia' });
    assert.equal(filters.from, period.start.toISOString()); assert.equal(filters.until, period.end.toISOString());
    assert.equal(filters.q, ''); assert.equal(filters.to, ''); assert.equal(filters.period, '');
  }
  assert.equal(metricReportFilters(data, 'historical').from, '');
  assert.equal(metricReportFilters(data, 'attraction', { attractionId: null }).attraction, 'none');
});
test('refresh serializes requests, discards superseded responses and queues latest selection', async () => {
  const requests = [], values = [], timers = new Map(), signals = []; let next = 0;
  const refresh = createMetricsRefresh({ request: signal => { signals.push(signal); const d = deferred(); requests.push(d); return d.promise; }, onSuccess: value => values.push(value), onError: assert.fail, onBusy() {}, setTimer: (fn, delay) => { assert.equal(delay, 30000); timers.set(++next, fn); return next; }, clearTimer: id => timers.delete(id) });
  refresh.setVisible(true); assert.equal(requests.length, 1);
  refresh.refresh(); refresh.refresh(true); refresh.refresh(true); assert.equal(requests.length, 1);
  assert.equal(signals[0].aborted, true);
  requests[0].resolve('obsolete'); await flush(); assert.deepEqual(values, []); assert.equal(requests.length, 2);
  requests[1].resolve('latest'); await flush(); assert.deepEqual(values, ['latest']); assert.equal(timers.size, 1);
  [...timers.values()][0](); assert.equal(requests.length, 3);
  refresh.dispose(); assert.equal(signals[2].aborted, true); requests[2].resolve('after disposal'); await flush(); assert.deepEqual(values, ['latest']); assert.equal(timers.size, 0);
});
test('visibility pauses polling and refreshes on return; errors preserve successful data', async () => {
  const requests = [], values = [], errors = [], timers = new Map(); let next = 0;
  const refresh = createMetricsRefresh({ request: () => { const d = deferred(); requests.push(d); return d.promise; }, onSuccess: value => values.push(value), onError: error => errors.push(error.message), onBusy() {}, setTimer: fn => { timers.set(++next, fn); return next; }, clearTimer: id => timers.delete(id) });
  refresh.setVisible(true); requests[0].resolve('saved'); await flush();
  refresh.setVisible(false); assert.equal(timers.size, 0); refresh.refresh(); assert.equal(requests.length, 1);
  refresh.setVisible(true); assert.equal(requests.length, 2);
  requests[1].reject(new Error('temporary')); await flush(); assert.deepEqual(values, ['saved']); assert.deepEqual(errors, ['temporary']);
  refresh.refresh(); refresh.setVisible(false); requests[2].resolve('hidden'); await flush(); assert.deepEqual(values, ['saved']);
  refresh.setVisible(true); assert.equal(requests.length, 4); refresh.dispose(); requests[3].resolve('ignored'); await flush();
});
test('following current period rolls over at Chihuahua midnight; historical selection remains', () => {
  const selection = { granularity: 'month', anchor: '2026-10-09', followCurrent: true };
  assert.equal(metricsSelection(selection, new Date('2026-10-10T05:59:59Z')).anchor, '2026-10-09');
  assert.equal(metricsSelection(selection, new Date('2026-10-10T06:00:00Z')).anchor, '2026-10-10');
  assert.equal(metricsSelection({ ...selection, followCurrent: false }, new Date('2026-10-10T06:00:00Z')).anchor, '2026-10-09');
});
