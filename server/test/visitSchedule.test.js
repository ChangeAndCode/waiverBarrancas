import test from "node:test";
import assert from "node:assert/strict";
import { canRegisterVisit, earliestVisitDate, parkDateTime, visitQrExpiresAt } from "../../shared/visitSchedule.js";
import { getWaiverQrExpiresAt, isWaiverQrExpired } from "../src/lib/waiverValidity.js";
import { visitQrResult } from "../src/lib/visitQr.js";

test("registration requires 24 hours before park-local midnight, inclusive at the boundary", () => {
  assert.equal(canRegisterVisit("2026-10-02", new Date("2026-10-01T06:00:00Z")), true);
  assert.equal(canRegisterVisit("2026-10-02", new Date("2026-10-01T06:00:00.001Z")), false);
  assert.equal(earliestVisitDate(new Date("2026-10-01T18:00:00Z")), "2026-10-03");
  for (const date of ["2026-02-30", "2026-13-01", "", null, {}, "2026-10-02T12:00:00Z"]) {
    assert.equal(canRegisterVisit(date), false);
  }
});

test("park-local assignment and expiry cross month/year boundaries independently of host timezone", () => {
  assert.equal(parkDateTime("2026-12-31", "14:30").toISOString(), "2026-12-31T20:30:00.000Z");
  assert.equal(parkDateTime("2026-12-31", "24:00"), null);
  assert.equal(parkDateTime("2026-12-31", "9:30"), null);
  assert.equal(visitQrExpiresAt("2026-12-31T20:30:00Z").toISOString(), "2027-01-02T06:00:00.000Z");
  assert.equal(visitQrExpiresAt("2028-02-28T20:30:00Z").toISOString(), "2028-03-01T06:00:00.000Z");
});

test("pending QR cannot authorize admission; assigned QR remains usable through the following day", () => {
  const waiver = { visitDate: "2026-10-02", assignedAt: null, status: "pending", participant: { fullName: "Prueba" } };
  assert.equal(getWaiverQrExpiresAt(waiver), null);
  assert.equal(isWaiverQrExpired(waiver, new Date("2030-01-01")), false);
  assert.equal(visitQrResult(waiver).accessAuthorized, false);
  waiver.assignedAt = parkDateTime(waiver.visitDate, "09:00");
  waiver.status = "approved";
  assert.equal(visitQrResult(waiver, new Date("2026-10-04T05:59:59.999Z")).accessAuthorized, true);
  assert.equal(isWaiverQrExpired(waiver, new Date("2026-10-04T06:00:00Z")), true);
});

test("legacy records retain the original 72-hour expiry", () => {
  const old = { createdAt: new Date("2026-10-01T12:00:00Z"), status: "signed" };
  assert.equal(isWaiverQrExpired(old, new Date("2026-10-04T11:59:59Z")), false);
  assert.equal(isWaiverQrExpired(old, new Date("2026-10-04T12:00:00Z")), true);
});
