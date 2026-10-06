import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { testApp, payload, staffToken } from "./fixture.js";

test("Staff puede consultar pendientes y registrar verificación de peso", async (t) => {
  const { app } = testApp(t.mock);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json() };
  };
  const created = await request("/public/waivers", "POST", payload());
  assert.equal(created.status, 201);
  const pending = await request("/reports/pending");
  assert.equal(pending.status, 200);
  assert.equal(pending.data.total, 1);
  const weight = await request(`/reports/waivers/${created.data.waiverId}/weight-verification`, "POST", { weight: 55, attractionId: payload().attractionIds[0], comment: "Verificado en báscula." });
  assert.equal(weight.status, 200);
  assert.equal(weight.data.safetyVerification.weightStatus, "within_range");
});

test("Staff no puede asignar horario antes de validar la carta", async (t) => {
  const { app } = testApp(t.mock);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const createdResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/public/waivers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
  const created = await createdResponse.json();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reports/waivers/${created.waiverId}/schedule`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({ qrToken: created.token, date: created.visitDate, group: "Grupo 1", time: "09:00", attractionId: payload().attractionIds[0] })
  });
  assert.equal(response.status, 409);
});
