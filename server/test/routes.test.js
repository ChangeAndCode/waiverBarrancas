import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { testApp, payload, staffToken, adminToken, secret, staff } from "./fixture.js";
import { verifyWaiverToken, signWaiverToken } from "../src/lib/token.js";
import { signAuthToken } from "../src/lib/auth.js";
import { parkDate } from "../../shared/visitSchedule.js";

test("registration, access control, Staff assignment, repeated scans, revocation and reports", async (t) => {
  const savedKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  t.after(() => { if (savedKey !== undefined) process.env.RESEND_API_KEY = savedKey; });
  const { app, records } = testApp(t.mock);
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
  for (const day of [undefined, "2026-02-30", parkDate()]) {
    const r = await request("/public/waivers", "POST", { ...payload(), visitDate: day });
    assert.equal(r.status, 400);
  }
  const malicious = { ...payload(), status: "validated", assignedAt: "2099-01-01", validatedBy: String(staff._id) };
  const created = await request("/public/waivers", "POST", malicious);
  assert.equal(created.status, 201);
  assert.equal(created.data.status, "pending_validation");
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
  const another = await request("/public/waivers", "POST", payload());
  assert.notEqual(another.data.token, token);
  assert.notEqual(another.data.folio, created.data.folio);
  assert.equal((await request(`/public/check/${token}`)).data.accessAuthorized, false);
  assert.equal((await request(`/reports/validate/${token}`)).status, 401);
  const visitorToken = signAuthToken({ ...staff, role: "visitor" }, secret);
  assert.equal((await request(`/reports/validate/${token}`, "POST", { assignedTime: "09:00" }, visitorToken)).status, 403);
  assert.equal((await request(`/reports/validate/${token}`, "GET", undefined, staffToken)).data.waiver.status, "pending_validation");
  assert.equal(stored.qrConsumedAt, null);
  assert.equal((await request(`/reports/validate/${token}`, "GET", undefined, staffToken)).data.review.participant.fullName, "Visitante Prueba");
  assert.equal((await request(`/public/check/${token}`)).data.review, undefined);
  for (const time of [null, "", "25:00", "2026-10-01T09:00"]) {
    assert.equal((await request(`/reports/validate/${token}`, "POST", { assignedTime: time }, staffToken)).status, 400);
  }
  // Two staff members cannot overwrite one another's approval.
  const approvals = await Promise.all(["09:00", "10:00"].map((assignedTime) => request(`/reports/validate/${token}`, "POST", { assignedTime }, staffToken)));
  assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 409]);
  assert.equal(stored.status, "validated");
  assert.equal(String(stored.validatedBy), String(staff._id));
  assert.ok(stored.validatedAt);
  for (let i = 0; i < 2; i++) {
    assert.equal((await request(`/reports/validate/${token}`, "GET", undefined, staffToken)).data.accessAuthorized, true);
    assert.equal((await request(`/public/check/${token}`)).data.accessAuthorized, true);
  }
  assert.equal(stored.qrConsumedAt, null);
  const report = await request("/admin/reports/waivers?status=pending_validation", "GET", undefined, adminToken);
  assert.equal(report.data.summary.pending_validation, 1);
  assert.equal(report.data.summary.validated, 0);
  assert.equal(report.data.items[0].visitDate, created.data.visitDate);
  stored.status = "revoked";
  assert.equal((await request(`/public/check/${token}`)).status, 404);
  assert.equal((await request(`/reports/validate/${token}`, "POST", { assignedTime: "11:00" }, staffToken)).status, 404);
  stored.status = "validated";
  stored.assignedAt = new Date("2020-01-01T15:00:00Z");
  assert.equal((await request(`/public/check/${token}`)).data.reason, "qr_expired");
  assert.equal((await request(`/reports/validate/${token}`, "GET", undefined, staffToken)).data.reason, "qr_expired");
  assert.equal((await request("/public/check/invalid-token")).status, 400);
  // An old record still has its one-use semantics.
  const legacyId = "507f1f77bcf86cd799439011";
  records.set(legacyId, { _id: legacyId, status: "signed", participant: { fullName: "Anterior" }, createdAt: new Date(), qrConsumedAt: null });
  const legacy = signWaiverToken(legacyId, secret);
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
  assert.equal([...records.values()][0].status, "pending_validation");
});
