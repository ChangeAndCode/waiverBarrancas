import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../src/models/User.js";
import { Waiver } from "../src/models/Waiver.js";
import { WaiverAuditEvent } from "../src/models/WaiverAuditEvent.js";
import { authRoutes } from "../src/routes/auth.js";
import { adminRoutes } from "../src/routes/admin.js";
import { reportRoutes } from "../src/routes/reports.js";
import { signAuthToken } from "../src/lib/auth.js";
import { signWaiverToken } from "../src/lib/token.js";
import { accessChangeError } from "../src/lib/userAccess.js";

const secret = "isolated-users-test-secret";
const password = "Access123";
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const matches = (row, filter = {}) => Object.entries(filter).every(([key, value]) => {
  if (value === null) return row[key] == null;
  if (value?.$ne !== undefined) return String(row[key]) !== String(value.$ne);
  return String(row[key]) === String(value);
});

async function setup(t) {
  const users = new Map();
  const make = async (role, name = role) => {
    const user = new User({ name, email: `${name}@example.test`, role, passwordHash: await bcrypt.hash(password, 4) });
    await user.validate();
    const record = clone(user.toObject());
    users.set(record._id, record);
    return record;
  };
  const admin = await make("admin");
  const staff = await make("staff");
  const taquilla = await make("taquilla");
  const query = lookup => {
    let excluded = [];
    const read = () => {
      const value = clone(lookup());
      const strip = row => { if (row) for (const key of excluded) delete row[key]; return row; };
      return Array.isArray(value) ? value.map(strip) : strip(value);
    };
    return {
      select(fields) { excluded = fields.split(" ").filter(f => f.startsWith("-")).map(f => f.slice(1)); return this; },
      sort() { return this; },
      lean: async () => read(),
      then(resolve, reject) { return Promise.resolve(read()).then(resolve, reject); }
    };
  };
  t.mock.method(User, "findOne", filter => query(() => [...users.values()].find(u => matches(u, filter)) || null));
  t.mock.method(User, "find", filter => query(() => [...users.values()].filter(u => matches(u, filter))));
  t.mock.method(User, "countDocuments", async filter => [...users.values()].filter(u => matches(u, filter)).length);
  t.mock.method(User, "create", async data => {
    if ([...users.values()].some(u => u.email === data.email)) throw Object.assign(new Error("duplicate"), { code: 11000 });
    const doc = new User(data);
    await doc.validate();
    const record = clone(doc.toObject());
    users.set(record._id, record);
    return record;
  });
  t.mock.method(User, "findOneAndUpdate", (filter, update, options) => query(() => {
    assert.equal(options.runValidators, true);
    const user = [...users.values()].find(u => matches(u, filter));
    if (!user) return null;
    Object.assign(user, clone(update.$set));
    for (const [key, value] of Object.entries(update.$inc || {})) user[key] = (user[key] || 0) + value;
    return user;
  }));
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes({ jwtSecret: secret }));
  app.use("/api/admin", adminRoutes({ jwtSecret: secret }));
  app.use("/api/reports", reportRoutes({ jwtSecret: secret }));
  app.use((error, _req, res, _next) => res.status(error.type === "entity.parse.failed" ? 400 : 500).json({ error: error.message }));
  const server = await new Promise(resolve => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, method = "GET", body, token = signAuthToken(admin, secret)) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: method === "GET" || body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };
  const login = user => request("/auth/login", "POST", { email: user.email, password }, "");
  return { users, admin, staff, taquilla, request, login, make };
}

function safe(response) {
  assert.ok(!JSON.stringify(response.data).includes("passwordHash"));
  assert.ok(!JSON.stringify(response.data).includes("authVersion"));
}

test("usuarios: crear, consultar y editar nombre/email/contraseña/perfil sin hashes", async t => {
  const { request, users } = await setup(t);
  const created = await request("/admin/users", "POST", { name: " New ", email: " NEW@Example.test ", password, role: "taquilla" });
  assert.equal(created.status, 201); safe(created);
  assert.equal(created.data.email, "new@example.test");
  const id = created.data.id;
  const previousToken = signAuthToken(users.get(id), secret);
  const edited = await request(`/admin/users/${id}`, "PATCH", { name: "Changed", email: "changed@example.test", role: "staff", password: "Changed123" });
  assert.equal(edited.status, 200); safe(edited);
  assert.equal(edited.data.name, "Changed");
  assert.equal(edited.data.role, "staff");
  assert.equal((await request("/auth/me", "GET", undefined, previousToken)).status, 401);
  assert.ok(await bcrypt.compare("Changed123", users.get(id).passwordHash));
  const list = await request("/admin/users"); safe(list);
  assert.equal(list.data.length, 4);
});

test("validaciones: payload, email, contraseña, rol, ID y duplicados incluso E11000", async t => {
  const { request, staff } = await setup(t);
  const base = { name: "Valid", email: "valid@example.test", password, role: "staff" };
  for (const body of [null, [], {}, { ...base, extra: true }, { ...base, name: " " }, { ...base, name: 123 }, { ...base, email: "bad" }, { ...base, email: {} }, { ...base, password: "short" }, { ...base, password: "á".repeat(37) }, { ...base, role: "visitor" }, { ...base, active: false }]) {
    assert.equal((await request("/admin/users", "POST", body)).status, 400, JSON.stringify(body));
  }
  for (const body of [{ name: "" }, { active: "false" }, { role: "unknown" }, { password: "short" }, { email: [] }, { deletedAt: null }, { passwordHash: "hash" }, {}]) {
    assert.equal((await request(`/admin/users/${staff._id}`, "PATCH", body)).status, 400);
  }
  assert.equal((await request("/admin/users/bad", "PATCH", { name: "Valid" })).status, 400);
  assert.equal((await request("/admin/users/bad", "DELETE")).status, 400);
  assert.equal((await request(`/admin/users/${new mongoose.Types.ObjectId()}`, "PATCH", { name: "Valid" })).status, 404);
  assert.equal((await request("/admin/users", "POST", { ...base, email: " STAFF@EXAMPLE.TEST " })).status, 409);
  assert.equal((await request(`/admin/users/${staff._id}`, "PATCH", { email: "admin@example.test" })).status, 409);
  assert.equal((await request(`/admin/users/${staff._id}`, "PATCH", { email: " STAFF@EXAMPLE.TEST " })).status, 200);
  t.mock.method(User, "create", async () => { throw Object.assign(new Error("race"), { code: 11000 }); });
  assert.equal((await request("/admin/users", "POST", base)).status, 409);
  t.mock.method(User, "findOneAndUpdate", () => { throw Object.assign(new Error("race"), { code: 11000 }); });
  assert.equal((await request(`/admin/users/${staff._id}`, "PATCH", { email: "free@example.test" })).status, 409);
});

test("login, suspensión, reactivación y authVersion invalidan tokens anteriores", async t => {
  const { request, login, staff } = await setup(t);
  const initial = await login(staff);
  assert.equal(initial.status, 200); safe(initial);
  const token = initial.data.token;
  assert.equal((await request("/auth/me", "GET", undefined, token)).status, 200);
  assert.equal((await request(`/admin/users/${staff._id}`, "PATCH", { active: false })).status, 200);
  assert.equal((await login(staff)).status, 401);
  assert.equal((await request("/auth/me", "GET", undefined, token)).status, 401);
  assert.equal((await request("/reports/pending", "GET", undefined, token)).status, 401);
  assert.equal((await request(`/admin/users/${staff._id}`, "PATCH", { active: true })).status, 200);
  assert.equal((await request("/auth/me", "GET", undefined, token)).status, 401);
  assert.equal((await login(staff)).status, 200);
  assert.equal((await request("/auth/login", "POST", { email: staff.email, password: "wrong" }, "")).status, 401);
  assert.equal((await request("/auth/login", "POST", { email: {} }, "")).status, 400);
  const legacy = jwt.sign({ sub: staff._id, role: "admin" }, secret);
  assert.equal((await request("/auth/me", "GET", undefined, legacy)).status, 401);
});

test("soft delete conserva referencias y email único; no admite login, edición o reactivación", async t => {
  const { request, login, staff, users } = await setup(t);
  const token = (await login(staff)).data.token;
  const waiver = new Waiver({ validatedBy: staff._id, review: { reviewedBy: staff._id }, schedule: { assignedBy: staff._id } });
  const event = new WaiverAuditEvent({ waiverId: waiver._id, userId: staff._id, userRole: "staff", action: "approved" });
  const before = JSON.stringify([waiver.toObject(), event.toObject()]);
  const removed = await request(`/admin/users/${staff._id}`, "DELETE");
  assert.equal(removed.status, 200); safe(removed);
  assert.ok(users.get(staff._id).deletedAt);
  assert.equal(JSON.stringify([waiver.toObject(), event.toObject()]), before);
  assert.equal((await login(staff)).status, 401);
  assert.equal((await request("/auth/me", "GET", undefined, token)).status, 401);
  assert.equal((await request(`/admin/users/${staff._id}`, "PATCH", { active: true })).status, 404);
  assert.equal((await request(`/admin/users/${staff._id}`, "PATCH", { name: "No" })).status, 404);
  assert.equal((await request(`/admin/users/${staff._id}`, "DELETE")).status, 404);
  assert.equal((await request("/admin/users", "POST", { name: "Reuse", email: staff.email, password, role: "staff" })).status, 409);
  assert.ok((await request("/admin/users")).data.find(u => u._id === staff._id).deletedAt);
});

test("perfil actual de MongoDB manda sobre el JWT; token inválido y propósitos ajenos rechazados", async t => {
  const { request, staff, admin, users } = await setup(t);
  const token = signAuthToken(staff, secret);
  assert.equal((await request("/admin/users", "GET", undefined, token)).status, 403);
  await request(`/admin/users/${staff._id}`, "PATCH", { role: "admin" });
  assert.equal((await request("/admin/users", "GET", undefined, token)).status, 200);
  await request(`/admin/users/${staff._id}`, "PATCH", { role: "taquilla" });
  assert.equal((await request("/admin/users", "GET", undefined, token)).status, 403);
  assert.equal((await request("/auth/me", "GET", undefined, token)).data.role, "taquilla");
  // Existing version-zero tokens remain usable until suspension/password change.
  const legacy = jwt.sign({ sub: admin._id, role: "staff" }, secret);
  assert.equal((await request("/admin/users", "GET", undefined, legacy)).status, 200);
  for (const invalid of ["", "bad", signAuthToken({ ...staff, _id: new mongoose.Types.ObjectId() }, secret), jwt.sign({ sub: "bad" }, secret), jwt.sign({ sub: admin._id }, secret, { expiresIn: -1 }), jwt.sign({ sub: admin._id }, "wrong"), jwt.sign({ purpose: "waiver-recovery", sub: admin._id }, secret), signWaiverToken(admin._id, secret)]) {
    assert.equal((await request("/auth/me", "GET", undefined, invalid)).status, 401);
  }
  users.get(admin._id).active = false;
  assert.equal((await request("/admin/users", "GET", undefined, legacy)).status, 401);
});

test("protección propia y del último administrador en operaciones normales", async t => {
  const { request, admin, make } = await setup(t);
  for (const body of [{ active: false }, { role: "staff" }, { role: "taquilla" }]) assert.equal((await request(`/admin/users/${admin._id}`, "PATCH", body)).status, 409);
  assert.equal((await request(`/admin/users/${admin._id}`, "DELETE")).status, 409);
  assert.equal((await request(`/admin/users/${admin._id}`, "PATCH", { name: "Allowed" })).status, 200);
  // Unit-level guard proves count protection even when actor is a different identity.
  const actor = { _id: new mongoose.Types.ObjectId() };
  for (const changes of [{ active: false }, { role: "staff" }]) assert.ok(await accessChangeError(actor, admin, changes));
  assert.ok(await accessChangeError(actor, admin, {}, true));
  const second = await make("admin", "second");
  assert.equal((await request(`/admin/users/${second._id}`, "PATCH", { role: "staff" })).status, 200);
  assert.equal((await request(`/admin/users/${second._id}`, "PATCH", { role: "admin" })).status, 200);
  assert.equal((await request(`/admin/users/${second._id}`, "PATCH", { active: false })).status, 200);
  assert.equal((await request(`/admin/users/${second._id}`, "DELETE")).status, 200);
});

test("aislamiento: Staff y Taquilla no administran; Taquilla no modifica, lista ni imprime", async t => {
  const { request, staff, taquilla } = await setup(t);
  for (const user of [staff, taquilla]) {
    const token = signAuthToken(user, secret);
    for (const [path, method, body] of [["/admin/users", "GET"], ["/admin/users", "POST", {}], [`/admin/users/${staff._id}`, "PATCH", { active: false }], [`/admin/users/${staff._id}`, "DELETE"], ["/admin/reports/waivers", "GET"], ["/admin/reports/waivers/export.csv", "GET"], [`/admin/waivers/${staff._id}/history`, "GET"], [`/admin/waivers/${staff._id}/record`, "GET"]]) {
      assert.equal((await request(path, method, body, token)).status, 403, `${user.role}: ${method} ${path}`);
    }
  }
  const token = signAuthToken(taquilla, secret);
  for (const [path, method] of [["/reports/pending", "GET"], ["/reports/waivers", "GET"], ["/reports/validate/example", "POST"], [`/reports/waivers/${staff._id}/review`, "POST"], [`/reports/waivers/${staff._id}/weight-verification`, "POST"], [`/reports/waivers/${staff._id}/schedule`, "PATCH"], [`/reports/waivers/${staff._id}/ticket`, "POST"], [`/reports/waivers/${staff._id}/activities/${staff._id}/review`, "POST"], [`/reports/waivers/${staff._id}/activities/${staff._id}/ticket`, "POST"]]) {
    assert.equal((await request(path, method, {}, token)).status, 403, path);
  }
});

test("Taquilla consulta carta y procedencia sin consumir QR legacy ni generar auditoría", async t => {
  const { request, taquilla } = await setup(t);
  const waiver = { _id: String(new mongoose.Types.ObjectId()), folio: "TEST", status: "approved", attractionName: "Test", participant: { fullName: "Visitor", cityState: "Chihuahua, Chihuahua", email: "visitor@example.test" }, createdAt: new Date(), waiverTextSnapshot: "<p>Signed text</p>" };
  t.mock.method(Waiver, "findOne", () => ({ lean: async () => waiver }));
  t.mock.method(Waiver, "findOneAndUpdate", () => { assert.fail("Read-only scan mutated waiver"); });
  t.mock.method(WaiverAuditEvent, "create", () => { assert.fail("Read-only scan wrote event"); });
  const token = signAuthToken(taquilla, secret);
  const qr = signWaiverToken(waiver._id, secret);
  for (const status of ["approved", "pending", "rejected", "revoked"]) {
    waiver.status = status;
    const response = await request(`/reports/validate/${qr}`, "GET", undefined, token);
    assert.equal(response.status, 200);
    assert.equal(response.data.waiver.participant.cityState, waiver.participant.cityState);
    assert.equal(response.data.waiver.waiverTextSnapshot, waiver.waiverTextSnapshot);
    assert.equal(response.data.accessAuthorized, status === "approved");
    assert.equal(waiver.qrConsumedAt, undefined);
  }
  waiver.status = "approved";
  waiver.qrConsumedAt = new Date();
  assert.equal((await request(`/reports/validate/${qr}`, "GET", undefined, token)).data.accessAuthorized, false);
  waiver.qrConsumedAt = null;
  waiver.createdAt = new Date("2000-01-01");
  assert.equal((await request(`/reports/validate/${qr}`, "GET", undefined, token)).data.accessAuthorized, false);
  waiver.visitDate = "2099-01-01";
  const expiredVisit = await request(`/reports/validate/${qr}`, "GET", undefined, token);
  assert.equal(expiredVisit.status, 200);
  assert.equal(expiredVisit.data.accessAuthorized, false);
  assert.equal(expiredVisit.data.waiver.waiverTextSnapshot, waiver.waiverTextSnapshot);
  assert.equal((await request("/reports/validate/invalid", "GET", undefined, token)).status, 400);
});
