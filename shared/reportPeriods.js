import { PARK_TIME_ZONE, parkDate, parkDateTime, addCalendarDays } from './visitSchedule.js';
export { PARK_TIME_ZONE };
export class ReportInputError extends Error { constructor(message) { super(message); this.status = 400; } }
export function validReportDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !parkDateTime(day)) throw new ReportInputError('Fecha inválida; utiliza YYYY-MM-DD.');
  return day;
}
export function reportPeriod(granularity = 'month', anchor = parkDate()) {
  validReportDay(anchor);
  if (!['day', 'week', 'month', 'year'].includes(granularity)) throw new ReportInputError('Periodo inválido.');
  let from = anchor, until;
  if (granularity === 'week') from = addCalendarDays(anchor, -((new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7));
  if (granularity === 'month') from = `${anchor.slice(0, 7)}-01`;
  if (granularity === 'year') from = `${anchor.slice(0, 4)}-01-01`;
  if (granularity === 'day' || granularity === 'week') until = addCalendarDays(from, granularity === 'day' ? 1 : 7);
  else {
    const date = new Date(`${from}T00:00:00Z`);
    if (granularity === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCFullYear(date.getUTCFullYear() + 1);
    until = date.toISOString().slice(0, 10);
  }
  const start = parkDateTime(from), end = parkDateTime(until);
  if (!start || !end) throw new ReportInputError('Periodo fuera de rango.');
  return { granularity, anchor, from, to: addCalendarDays(until, -1), start, end, timeZone: PARK_TIME_ZONE };
}
export function periodBuckets(period) {
  const buckets = [];
  let start = period.start;
  while (start < period.end) {
    let end, key;
    if (period.granularity === 'day') {
      end = new Date(Math.min(start.getTime() + 3600000, period.end.getTime()));
      // UTC keys distinguish repeated local hours during historical DST transitions.
      key = start.toISOString();
    } else if (period.granularity === 'year') {
      const day = parkDate(start), date = new Date(`${day}T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + 1);
      end = parkDateTime(date.toISOString().slice(0, 10)); key = day.slice(0, 7);
    } else { key = parkDate(start); end = parkDateTime(addCalendarDays(key, 1)); }
    buckets.push({ key, start, end, count: 0 }); start = end;
  }
  return buckets;
}
