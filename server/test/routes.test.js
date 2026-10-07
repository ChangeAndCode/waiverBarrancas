import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { testApp, payload, staffToken, adminToken, secret, staff, visitor } from "./fixture.js";
import { verifyWaiverToken, signWaiverToken } from "../src/lib/token.js";
import { signAuthToken } from "../src/lib/auth.js";
import { parkDate } from "../../shared/visitSchedule.js";

test("registration, access control, Staff assignment, repeated scans, revocation and reports", async (t) => {
  const savedKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  t.after(() => { if (savedKey !== undefined) process.env.RESEND_API_KEY = savedKey; });
  const { app, records, events } = testApp(t.mock);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (path, method = "GET", body, auth) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, data: await r.json() };
  };
  for (const day of [undefined, "2026-02-30", "2020-01-01"]) {
    const r = await request("/public/waivers", "POST", { ...payload(), visitDate: day });
    assert.equal(r.status, 400);
  }
  for (const day of [parkDate(), parkDate(new Date(Date.now() + 86400000)), "2099-01-01"]) {
    const registered = await request("/public/waivers", "POST", { ...payload(), visitDate: day });
    assert.equal(registered.status, 201);
  }
  records.clear();
  const malicious = { ...payload(), status: "approved", assignedAt: "2099-01-01", scheduleAssignedAt: "2099-01-01", qrExpiresAt: "2099-01-02", validatedBy: String(staff._id) };
  const created = await request("/public/waivers", "POST", malicious);
  assert.equal(created.status, 201);
  assert.equal(created.data.status, "pending");
  assert.equal(created.data.assignedAt, null);
  assert.equal(created.data.emailSent, false);
  const token = created.data.token;
  const decoded = verifyWaiverToken(token, secret);
  assert.equal(decoded.exp, undefined);
  const waiverId = decoded.waiverId;
  const stored = records.get(waiverId);
  assert.equal(stored.participant.cityState, "Chihuahua, Chihuahua");
  assert.equal(stored.attractionIds.length, 2);
  assert.equal(stored.validatedBy, null);
  assert.equal(stored.scheduleAssignedAt, null);
  assert.equal(stored.qrExpiresAt, null);
  const another = await request("/public/waivers", "POST", payload());
  assert.notEqual(another.data.token, token);
  assert.notEqual(another.data.folio, created.data.folio);
  assert.equal((await request(`/public/check/${token}`)).data.accessAuthorized, false);
  assert.equal((await request(`/reports/validate/${token}`)).status, 401);


const visitorToken = signAuthToken(visitor, secret);
  assert.equal((await request(`/reports/validate/${token}`, "POST", { assignedTime: "09:00" }, visitorToken)).status, 403);
  const staffPending = (await request(`/reports/validate/${token}`, "GET", undefined, staffToken)).data;
  assert.equal(staffPending.waiver.status, "pending");
  assert.equal(staffPending.waiver.databaseId, waiverId);
  assert.equal(staffPending.waiver.attractionId, String(stored.attractionId));
  assert.equal(staffPending.waiver.participant.email, stored.participant.email);
  assert.equal(staffPending.waiver.waiverTextSnapshot, stored.waiverTextSnapshot);
  assert.equal(staffPending.waiver.hasSignature, true);
  assert.equal(staffPending.waiver.witness.hasSignature, true);
  assert.equal((await request(`/reports/waivers/${waiverId}/ticket`, "POST", { qrToken: token }, staffToken)).status, 409);
  assert.equal(stored.qrConsumedAt, null);
  assert.equal((await request(`/reports/validate/${token}`, "GET", undefined, staffToken)).data.review.participant.fullName, "Visitante Prueba");
  assert.equal((await request(`/public/check/${token}`)).data.review, undefined);
  assert.equal((await request(`/public/check/${token}`)).data.waiver.participant, undefined);
  assert.equal((await request(`/public/check/${token}`)).data.waiver.databaseId, undefined);
  for (const time of [null, "", "25:00", "2026-10-01T09:00"]) {
    assert.equal((await request(`/reports/validate/${token}`, "POST", { assignedTime: time }, staffToken)).status, 400);
  }
  // Two staff members cannot overwrite one another's approval.
  const approvals = await Promise.all(["09:00", "10:00"].map((assignedTime) => request(`/reports/validate/${token}`, "POST", { assignedTime }, staffToken)));
  assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 409]);
  const approvedResponse = approvals.find((r) => r.status === 200).data;
  assert.equal(approvedResponse.waiver.databaseId, waiverId);
  assert.equal(approvedResponse.waiver.review.decision, "approved");
  assert.equal(approvedResponse.waiver.participant.email, stored.participant.email);
  assert.equal(stored.status, "approved");
  assert.equal(String(stored.validatedBy), String(staff._id));
  assert.ok(stored.validatedAt);
  assert.deepEqual(stored.scheduleAssignedAt, new Date());
  const firstAssignment = stored.scheduleAssignedAt;
  const firstExpiry = stored.qrExpiresAt;
  const assignmentEvent = events.find(e => e.waiverId === stored._id && e.action === "schedule_assigned");
  assert.equal(assignmentEvent.userId, staff._id);
  assert.deepEqual(assignmentEvent.metadata.scheduleAssignedAt, firstAssignment);
  assert.deepEqual(assignmentEvent.metadata.qrExpiresAt, firstExpiry);
  assert.equal(assignmentEvent.metadata.timezone, "America/Chihuahua");
  for (let i = 0; i < 2; i++) {
    assert.equal((await request(`/reports/validate/${token}`, "GET", undefined, staffToken)).data.accessAuthorized, true);
    assert.equal((await request(`/public/check/${token}`)).data.accessAuthorized, true);
  }
  assert.equal(stored.qrConsumedAt, null);
  assert.equal((await request(`/reports/waivers/${waiverId}/ticket`, "POST", { qrToken: token }, staffToken)).status, 409);
  stored.safetyVerification = { weightStatus: "within_range", weightVerified: 55, comments: "Prueba" };
  const schedule = { qrToken: token, date: stored.visitDate, group: "Grupo 1", time: "09:00", attractionId: stored.attractionId };
  assert.equal((await request(`/reports/waivers/${waiverId}/schedule`, "PATCH", schedule, staffToken)).status, 200);
  assert.equal((await request(`/reports/waivers/${waiverId}/schedule`, "PATCH", { ...schedule, date: "2099-01-01", time: "10:00" }, staffToken)).status, 200);
  assert.equal(new Date(stored.assignedAt).toISOString(), "2099-01-01T16:00:00.000Z");
  assert.deepEqual(stored.scheduleAssignedAt, firstAssignment);
  assert.deepEqual(stored.qrExpiresAt, firstExpiry);
  await request(`/reports/waivers/${waiverId}/schedule`, "PATCH", schedule, staffToken);
  const rescanned = (await request(`/reports/validate/${token}`, "GET", undefined, staffToken)).data;
  assert.equal(rescanned.waiver.schedule.group, "Grupo 1");
  assert.equal(rescanned.waiver.review.decision, "approved");
  const printed = await request(`/reports/waivers/${waiverId}/ticket`, "POST", { qrToken: token }, staffToken);
  assert.equal(printed.status, 200);
  assert.equal(printed.data.ticket.qrToken, token);
  assert.equal(printed.data.ticket.date, stored.visitDate);
  assert.equal(printed.data.ticket.time, "09:00");
  assert.equal(printed.data.ticket.group, "Grupo 1");
  assert.equal(printed.data.ticket.fullName, stored.participant.fullName);
  assert.equal(printed.data.ticket.cityState, stored.participant.cityState);
  assert.equal(printed.data.ticket.attractionName, stored.schedule.attractionName);
  assert.equal(printed.data.ticket.chihuahuaBenefit, true);
  const otherId = verifyWaiverToken(another.data.token, secret).waiverId;
  const rejected = await request(`/reports/waivers/${otherId}/review`, "POST", { decision: "rejected", comment: "No cumple requisitos" }, staffToken);
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.waiver.status, "rejected");
  assert.equal((await request(`/reports/validate/${another.data.token}`, "GET", undefined, staffToken)).status, 404);
const report = await request(
  "/admin/reports/waivers?status=approved",
  "GET",
  undefined,
  adminToken
);

assert.equal(report.data.summary.approved, 1);
assert.equal(report.data.summary.pending, 0);
assert.equal(report.data.items[0].visitDate, created.data.visitDate);


  stored.status = "revoked";
  assert.equal((await request(`/public/check/${token}`)).status, 404);
  assert.equal((await request(`/reports/validate/${token}`, "POST", { assignedTime: "11:00" }, staffToken)).status, 404);
  assert.equal((await request(`/admin/waivers/${waiverId}/status`, "PATCH", { status: "approved" }, adminToken)).status, 409);
  stored.status = "approved";
  t.mock.timers.setTime(new Date(firstExpiry).getTime());
  assert.equal((await request(`/admin/waivers/${waiverId}/status`, "PATCH", { status: "pending" }, adminToken)).status, 409);
  assert.equal((await request(`/reports/waivers/${waiverId}/schedule`, "PATCH", schedule, staffToken)).status, 409);
  assert.equal((await request(`/reports/waivers/${waiverId}/ticket`, "POST", { qrToken: token }, staffToken)).status, 409);
  assert.equal((await request(`/reports/validate/${token}`, "POST", { assignedTime: "11:00" }, staffToken)).status, 409);
  assert.equal((await request(`/public/check/${token}`)).data.reason, "qr_expired");
  assert.equal((await request(`/reports/validate/${token}`, "GET", undefined, staffToken)).data.reason, "qr_expired");
  assert.equal((await request("/public/check/invalid-token")).status, 400);
  // An old record still has its one-use semantics.
  const legacyId = "507f1f77bcf86cd799439011";
  records.set(legacyId, { _id: legacyId, status: "signed", participant: { fullName: "Anterior" }, createdAt: new Date(), qrConsumedAt: null });
  const legacy = signWaiverToken(legacyId, secret);
  assert.equal((await request(`/public/check/${legacy}`)).data.reason, "waiver_pending");
  assert.equal((await request(`/reports/validate/${legacy}`, "GET", undefined, staffToken)).data.requiresReview, true);
  assert.equal(records.get(legacyId).qrConsumedAt, null);
  records.get(legacyId).status = "approved";
  assert.equal((await request(`/reports/validate/${legacy}`, "GET", undefined, staffToken)).data.valid, true);
  assert.equal((await request(`/reports/validate/${legacy}`, "GET", undefined, staffToken)).data.reason, "qr_already_used");
});

test("provider failure preserves registration and returns the QR without claiming delivery", async (t) => {
  const oldKey = process.env.RESEND_API_KEY, oldFrom = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "park@example.test";
  t.after(() => {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = oldFrom;
  });
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (url, options) => String(url).startsWith("https://api.resend.com/")
    ? Promise.resolve({ ok: false, status: 503, text: async () => "simulated failure" })
    : realFetch(url, options));
  t.mock.method(console, "error", () => {});
  const { app, records } = testApp(t.mock);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/public/waivers`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload())
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.emailSent, false);
  assert.ok(result.qrUrl.includes(result.token));
  assert.equal(records.size, 1);
  assert.equal([...records.values()][0].status, "pending");
});
