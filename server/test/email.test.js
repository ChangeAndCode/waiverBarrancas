import test from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { sendWaiverQrEmail } from "../src/lib/email.js";

const message = { to: "visitor@example.test", participantName: "<Visitante>", attractionNames: ["Bosque & Aéreo", "ZipRider"], waiverId: "PB1", signedAt: new Date(), visitDate: "2026-12-31", qrUrl: "https://example.test/check/unique-token" };

test("email uses a locally generated PNG with the exact QR link and conditional-access notice", async (t) => {
  const oldKey = process.env.RESEND_API_KEY, oldFrom = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "park@example.test";
  t.after(() => {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = oldFrom;
  });
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    bodies.push(JSON.parse(options.body));
    return { ok: true };
  });
  assert.equal((await sendWaiverQrEmail(message)).sent, true);
  assert.equal((await sendWaiverQrEmail({ ...message, locale: "en" })).sent, true);
  const body = bodies[0];
  assert.match(body.html, /Pendiente de validación/);
  assert.match(body.html, /no garantiza el acceso/);
  assert.match(body.html, /00:00 del día siguiente a esa asignación/);
  assert.match(bodies[1].html, /00:00 the next day/);
  assert.match(body.html, /&lt;Visitante&gt;/);
  assert.match(body.html, /2026-12-31/);
  assert.match(body.html, /cid:waiver-qr/);
  assert.doesNotMatch(body.html, /qrserver/);
  assert.match(bodies[1].html, /Pending validation/);
  assert.equal(body.attachments[0].content_id, "waiver-qr");
  const expected = await QRCode.toBuffer(message.qrUrl, { type: "png", width: 420 });
  assert.deepEqual(Buffer.from(body.attachments[0].content, "base64"), expected);
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503, text: async () => "unavailable" }));
  await assert.rejects(sendWaiverQrEmail(message), /Resend error 503/);
  delete process.env.RESEND_API_KEY;
  assert.equal((await sendWaiverQrEmail(message)).sent, false);
});
