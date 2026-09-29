// Isolated fixture: actual Express routes and Mongoose validation; persistence replaced in memory.
// Never import this module from production code. It does not connect to MongoDB or send mail.
import express from "express";
import mongoose from "mongoose";
import { Waiver } from "../src/models/Waiver.js";
import { Attraction } from "../src/models/Attraction.js";
import { FolioCounter } from "../src/models/FolioCounter.js";
import { publicRoutes } from "../src/routes/public.js";
import { reportRoutes } from "../src/routes/reports.js";
import { adminRoutes } from "../src/routes/admin.js";
import { signAuthToken } from "../src/lib/auth.js";
import { PARK_ATTRACTIONS } from "../src/lib/parkAttractions.js";
import { earliestVisitDate } from "../../shared/visitSchedule.js";

export const secret = "local-test-secret-not-for-production";
export const staff = { _id: new mongoose.Types.ObjectId(), name: "Staff Prueba", email: "staff@example.test", role: "staff" };
export const staffToken = signAuthToken(staff, secret);
export const adminToken = signAuthToken({ ...staff, role: "admin" }, secret);
export const attractions = PARK_ATTRACTIONS.map((a) => ({ ...a, _id: String(new mongoose.Types.ObjectId()), active: true, waiverText: "<p>Carta de prueba local sin efectos legales.</p>" }));
export const signature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
export function payload() {
  return { visitDate: earliestVisitDate(), attractionIds: attractions.slice(0, 2).map((a) => String(a._id)),
    participant: { fullName: "Visitante Prueba", birthDate: "1990-01-01", gender: "femenino", phone: "6141234567", email: "visitante@example.test",
      nationality: "México", cityState: "Chihuahua, Chihuahua", medications: "No", emergencyContactName: "Contacto Prueba", emergencyContactPhone: "6141234568", emergencyContactRelationship: "Hermana" },
    answers: { hasMedicalCondition: false, consumedAlcoholOrDrugs: false, acceptsSafetyRules: true },
    acceptedText: true, signatureName: "Visitante Prueba", signatureImage: signature, witness: { signatureImage: signature }
  };
}

export function testApp(mock) {
  const records = new Map();
  let seq = 0;
  const matches = (w, filter) => Object.entries(filter).every(([key, value]) => {
    if (value === null) return w[key] == null;
    return String(w[key]) === String(value);
  });
  const query = (rows) => {
    let offset = 0, limit = rows.length;
    return { select() { return this; }, sort() { return this; }, skip(n) { offset = n; return this; }, limit(n) { limit = n; return this; },
      async lean() { return structuredClone(rows.slice(offset, offset + limit)); } };
  };
  mock.method(Attraction, "find", (filter) => query(attractions.filter((a) => !filter._id || filter._id.$in.includes(String(a._id)))));
  mock.method(FolioCounter, "exists", async () => true);
  mock.method(FolioCounter, "findByIdAndUpdate", async () => ({ seq: ++seq }));
  mock.method(Waiver, "create", async (data) => {
    const doc = new Waiver(data);
    await doc.validate();
    const w = { ...doc.toObject(), _id: String(doc._id), createdAt: new Date(), updatedAt: new Date() };
    records.set(w._id, w);
    return w;
  });
  mock.method(Waiver, "findById", (id) => ({ lean: async () => structuredClone(records.get(String(id)) || null) }));
  mock.method(Waiver, "find", (filter = {}) => query([...records.values()].filter((w) => matches(w, filter))));
  mock.method(Waiver, "countDocuments", async (filter = {}) => [...records.values()].filter((w) => matches(w, filter)).length);
  mock.method(Waiver, "findOneAndUpdate", (filter, update) => ({ lean: async () => {
    const w = [...records.values()].find((w) => matches(w, filter));
    if (!w) return null;
    Object.assign(w, update.$set);
    return structuredClone(w);
  } }));
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/public", publicRoutes({ jwtSecret: secret }));
  app.use("/api/reports", reportRoutes({ jwtSecret: secret }));
  app.use("/api/admin", adminRoutes({ jwtSecret: secret }));
  return { app, records };
}
