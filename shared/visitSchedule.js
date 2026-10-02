export const PARK_TIME_ZONE = "America/Chihuahua";
export const DAY_MS = 24 * 60 * 60 * 1000;

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PARK_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

function parkParts(date) {
  return Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
}

export function parkDate(date = new Date()) {
  const p = parkParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function addCalendarDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Convert a park-local date/time to an instant without relying on the server/browser timezone.
export function parkDateTime(day, time = "00:00") {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const wall = Date.parse(`${day}T${time}:00Z`);
  if (!Number.isFinite(wall)) return null;
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const p = parkParts(new Date(instant));
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    instant += wall - represented;
  }
  const result = new Date(instant);
  const p = parkParts(result);
  return parkDate(result) === day && `${p.hour}:${p.minute}` === time ? result : null;
}

export function canRegisterVisit(day, now = new Date()) {
  return Boolean(parkDateTime(day) && day >= parkDate(now));
}

export function earliestVisitDate(now = new Date()) {
  return parkDate(now);
}

export function visitQrExpiresAt(scheduleAssignedAt) {
  if (!scheduleAssignedAt) return null;
  const assigned = new Date(scheduleAssignedAt);
  if (!Number.isFinite(assigned.getTime())) return null;
  // Exclusive boundary: midnight following the real assignment day.
  return parkDateTime(addCalendarDays(parkDate(assigned), 1));
}
