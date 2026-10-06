import test from "node:test";
import assert from "node:assert/strict";
import { canRegisterVisit, earliestVisitDate, parkDateTime, visitQrExpiresAt } from "../../shared/visitSchedule.js";
import { getWaiverQrExpiresAt, isWaiverQrExpired, qrWriteGuard } from "../src/lib/waiverValidity.js";
import { visitQrResult } from "../src/lib/visitQr.js";

test("registration accepts the visit day, day before and earlier without a maximum lead time", () => {
  const now = new Date("2026-10-01T18:00:00Z");
  for (const day of ["2026-10-01", "2026-10-02", "2099-01-01"]) assert.equal(canRegisterVisit(day, now), true);
  assert.equal(canRegisterVisit("2026-09-30", now), false);
  assert.equal(earliestVisitDate(now), "2026-10-01");
  assert.equal(earliestVisitDate(new Date("2026-10-02T05:59:59.999Z")), "2026-10-01");
  assert.equal(earliestVisitDate(new Date("2026-10-02T06:00:00Z")), "2026-10-02");
  for (const day of ["2026-02-30", "2026-13-01", "", null, {}, "2026-10-02T12:00:00Z"]) assert.equal(canRegisterVisit(day, now), false);
});

test("expiry is the next Chihuahua midnight across month, year and leap-day boundaries", () => {
  assert.equal(parkDateTime("2026-12-31", "14:30").toISOString(), "2026-12-31T20:30:00.000Z");
  assert.equal(parkDateTime("2026-12-31", "24:00"), null);
  assert.equal(parkDateTime("2026-12-31", "9:30"), null);
  assert.equal(visitQrExpiresAt("2026-12-31T20:30:00Z").toISOString(), "2027-01-01T06:00:00.000Z");
  assert.equal(visitQrExpiresAt("2028-02-28T20:30:00Z").toISOString(), "2028-02-29T06:00:00.000Z");
});

test("first real assignment activates until exclusive midnight independently of visit time", () => {
  const w = { visitDate: "2026-12-31", assignedAt: null, status: "pending", participant: { fullName: "Prueba" } };
  assert.equal(getWaiverQrExpiresAt(w), null);
  assert.equal(isWaiverQrExpired(w, new Date("2030-01-01")), false);
  assert.equal(visitQrResult(w).accessAuthorized, false);
  w.assignedAt = parkDateTime(w.visitDate, "09:00");
  w.scheduleAssignedAt = new Date("2026-10-02T18:00:00Z");
  w.qrExpiresAt = visitQrExpiresAt(w.scheduleAssignedAt);
  w.validatedAt = w.scheduleAssignedAt;
  w.status = "approved";
  const before = new Date("2026-10-03T05:59:59.999Z");
  assert.equal(visitQrResult(w, before).accessAuthorized, true);
  assert.equal(isWaiverQrExpired(w, new Date("2026-10-03T06:00:00Z")), true);
  w.assignedAt = parkDateTime("2099-01-01", "10:00");
  assert.equal(getWaiverQrExpiresAt(w).toISOString(), "2026-10-03T06:00:00.000Z");
  assert.deepEqual(qrWriteGuard(w).$expr, { $gt: [{ $literal: w.qrExpiresAt }, "$$NOW"] });
  w.validatedAt = null;
  assert.equal(visitQrResult(w, before).accessAuthorized, false);
});

test("historical records retain 72 hours or the former scheduled-visit boundary without backfill", () => {
  const old = { createdAt: new Date("2026-10-01T12:00:00Z"), status: "signed" };
  assert.equal(isWaiverQrExpired(old, new Date("2026-10-04T11:59:59Z")), false);
  assert.equal(isWaiverQrExpired(old, new Date("2026-10-04T12:00:00Z")), true);
  const visit = { visitDate: "2026-10-02", assignedAt: parkDateTime("2026-10-02", "09:00") };
  assert.equal(getWaiverQrExpiresAt(visit).toISOString(), "2026-10-04T06:00:00.000Z");
  assert.equal(visit.scheduleAssignedAt, undefined);
});
