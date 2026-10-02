// Isolated fixture: actual Express routes and Mongoose validation; persistence replaced in memory.
// Never import this module from production code. It does not connect to MongoDB or send mail.
import { recoveryRoutes } from "../src/routes/recovery.js";
import { WaiverRecovery } from "../src/models/WaiverRecovery.js";
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
import { earliestVisitDate, parkDate, parkDateTime } from "../../shared/visitSchedule.js";
import { WaiverAuditEvent } from "../src/models/WaiverAuditEvent.js";
import { User } from "../src/models/User.js";

export const secret = "local-test-secret-not-for-production";
export const staff = {
  _id: new mongoose.Types.ObjectId(),
  name: "Staff Prueba",
  email: "staff@example.test",
  role: "staff",
  active: true
};

export const admin = {
  _id: new mongoose.Types.ObjectId(),
  name: "Admin Prueba",
  email: "admin@example.test",
  role: "admin",
  active: true
};

export const visitor = {
  _id: new mongoose.Types.ObjectId(),
  name: "Visitor Prueba",
  email: "visitor@example.test",
  role: "visitor",
  active: true
};

export const staffToken = signAuthToken(staff, secret);
export const adminToken = signAuthToken(admin, secret);
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
  // Keep route tests at 07:00 park time so same-day future slots are deterministic.
  mock.timers.enable({ apis: ["Date"], now: parkDateTime(parkDate(), "07:00").getTime() });
  const records = new Map();
  let seq = 0;
  const valuesAt = (obj, path) => {
    if (!path.length) return Array.isArray(obj) ? obj : [obj];
    if (Array.isArray(obj)) return obj.flatMap(item => valuesAt(item, path));
    return valuesAt(obj?.[path[0]], path.slice(1));
  };
  const matches = (w, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === "$expr") return new Date(value.$gt[0].$literal) > new Date();
    const values = valuesAt(w, key.split("."));
    if (value === null) return values.every(v => v == null);
    if (value && typeof value === "object") {
      if (value.$elemMatch) return (w[key] || []).some(a => matches(a, value.$elemMatch));
      if (value.$ne !== undefined) return values.every(v => String(v) !== String(value.$ne));
      if (value.$gt !== undefined) return values.some(v => new Date(v) > value.$gt);
      if (value.$regex) return values.some(v => new RegExp(value.$regex, value.$options).test(String(v)));
      if (value.$in) return values.some(v => value.$in.some(item => String(v) === String(item)));
    }
    return values.some(v => String(v) === String(value));
  });
  const query = (rows) => {
    let offset = 0, limit = rows.length;
    return { select() { return this; }, sort() { return this; }, skip(n) { offset = n; return this; }, limit(n) { limit = n; return this; },
      async lean() { return structuredClone(rows.slice(offset, offset + limit)); } };
  };
  mock.method(Attraction, "findOne", filter => ({ lean: async () => attractions.find(a => matches(a, filter)) || null }));
  mock.method(Attraction, "find", (filter) => query(attractions.filter((a) => !filter._id || filter._id.$in.includes(String(a._id)))));
  mock.method(FolioCounter, "exists", async () => true);
  mock.method(FolioCounter, "findByIdAndUpdate", async () => ({ seq: ++seq }));
  mock.method(Waiver, "create", async (data) => {
    const doc = new Waiver(data);
    await doc.validate();
    // Preserve ObjectId values as strings when cloning records in memory.
    const w = { ...JSON.parse(JSON.stringify(doc.toObject())), _id: String(doc._id), createdAt: new Date(), updatedAt: new Date() };
    records.set(w._id, w);
    return w;
  });
  const singleQuery = (lookup) => ({
    lean: async () => structuredClone(lookup() || null),
    then(resolve, reject) {
      const record = lookup();
      const document = record ? { ...structuredClone(record), async save() {
        const { save, ...data } = this;
        Object.assign(record, data);
      } } : null;
      return Promise.resolve(document).then(resolve, reject);
    }
  });
  mock.method(Waiver, "findById", (id) => singleQuery(() => records.get(String(id))));
  mock.method(Waiver, "findOne", (filter) => singleQuery(() => [...records.values()].find((w) => matches(w, filter))));
  mock.method(Waiver, "find", (filter = {}) => query([...records.values()].filter((w) => matches(w, filter))));
  mock.method(Waiver, "countDocuments", async (filter = {}) => [...records.values()].filter((w) => matches(w, filter)).length);
  const updateRecord = (w, update, filter) => {
    const positional = filter.additionalActivities?.$elemMatch ? w.additionalActivities.find(a => matches(a, filter.additionalActivities.$elemMatch)) : null;
    for (const [path, value] of Object.entries(update.$set || {})) {
      const parts = path.split(".");
      const key = parts.pop();
      let target = w;
      for (const part of parts) {
        if (part === "$") target = positional;
        else target = target[part] ??= {};
      }
      target[key] = value;
    }
    for (const [path, value] of Object.entries(update.$push || {})) {
      // MongoDB casts embedded IDs when persisting the document.
      (w[path] ??= []).push(JSON.parse(JSON.stringify(value)));
    }
    return w;
  };
  mock.method(Waiver, "updateOne", async (filter, update) => {
    const w = [...records.values()].find(w => matches(w, filter));
    if (w) updateRecord(w, update, filter);
    return { modifiedCount: w ? 1 : 0 };
  });
  mock.method(Waiver, "findOneAndUpdate", (filter, update) => ({ lean: async () => {
    const w = [...records.values()].find(w => matches(w, filter));
    return w ? structuredClone(updateRecord(w, update, filter)) : null;
  } }));
  const recoveries = [];
  mock.method(WaiverRecovery, "create", async data => { const r = { ...data, usedAt: null }; recoveries.push(r); return r; });
  mock.method(WaiverRecovery, "findOneAndUpdate", (filter, update) => ({ lean: async () => {
    const r = recoveries.find(r => matches(r, filter));
    return r ? structuredClone(updateRecord(r, update, filter)) : null;
  } }));
  const events = [];
  mock.method(WaiverAuditEvent, "create", async (data) => {
    const event = { ...data, _id: new mongoose.Types.ObjectId(), createdAt: new Date() };
    events.push(event);
    return event;
  });
mock.method(User, "findOne", (filter) => ({
  select() {
    return this;
  },
  async lean() {
    const userId = String(filter?._id);

    if (userId === String(staff._id)) {
      return { ...staff };
    }

    if (userId === String(visitor._id)) {
      return { ...visitor };
    }

    if (userId === String(admin._id)) {
      return { ...admin };
    }

    return null;
  }
}));
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/public/recovery", recoveryRoutes({ jwtSecret: secret }));
  app.use("/api/public", publicRoutes({ jwtSecret: secret }));
  app.use("/api/reports", reportRoutes({ jwtSecret: secret }));
  app.use("/api/admin", adminRoutes({ jwtSecret: secret }));
  return { app, records, recoveries, events };
}
