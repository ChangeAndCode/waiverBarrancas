import { parkDate } from '../../../shared/visitSchedule.js';
export function metricsSelection(selection, now = new Date()) { return selection.followCurrent ? { ...selection, anchor: parkDate(now) } : selection; }
export const emptyReportFilters = () => ({ attractionId: '', attraction: '', provenance: '', from: '', to: '', until: '', status: '', period: '', q: '' });
export function metricReportFilters(data, kind, row) {
  const filters = emptyReportFilters();
  const range = kind === 'current' ? row : kind === 'interval' ? row : data.period;
  if (kind !== 'historical') {
    filters.from = new Date(range.start).toISOString();
    filters.until = new Date(range.end).toISOString();
  }
  if (kind === 'state') filters.status = row.status;
  if (kind === 'attraction') {
    if (row.attractionId) filters.attractionId = String(row.attractionId);
    else filters.attraction = 'none';
  }
  if (kind === 'provenance') filters.provenance = row.category;
  return filters;
}

// One request at a time; only selection changes queue a replacement request.
// The callbacks and clock are injected so lifecycle and races can be tested without a browser.
export function createMetricsRefresh({ request, onSuccess, onError, onBusy, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let active = true, visible = false, running = false, queued = false, generation = 0, timer, controller;
  function clear() { clearTimer(timer); timer = undefined; }
  function schedule() { clear(); if (active && visible) timer = setTimer(() => refresh(), 30000); }
  async function refresh(changed = false) {
    if (!active) return;
    if (changed) { generation += 1; queued = true; controller?.abort(); }
    if (!visible || running) return;
    clear(); queued = false; running = true; const epoch = generation; controller = new AbortController(); onBusy(true);
    try {
      const result = await request(controller.signal);
      if (active && visible && epoch === generation) onSuccess(result);
    } catch (error) {
      if (active && visible && epoch === generation) onError(error);
    } finally {
      running = false;
      if (active) {
        onBusy(false);
        if (queued && visible) void refresh(); else schedule();
      }
    }
  }
  return {
    refresh,
    setVisible(value) {
      if (!active || visible === value) return;
      visible = value; generation += 1; clear(); if (!value) controller?.abort();
      if (value) { queued = true; void refresh(); }
    },
    dispose() { active = false; generation += 1; queued = false; controller?.abort(); clear(); }
  };
}
