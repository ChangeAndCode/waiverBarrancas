import { Router } from "express";
import bcrypt from "bcryptjs";
import { Attraction } from "../models/Attraction.js";
import { Waiver } from "../models/Waiver.js";
import { User } from "../models/User.js";
import { requireAuth, requireRoles } from "../lib/auth.js";
import { nowMs, perfLog } from "../lib/perf.js";

const MAX_CSV_ROWS = 50000;
const waiverSelectLean =
  "-signatureImage -guardian.signatureImage -witness.signatureImage -waiverTextSnapshot";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function waiverAdminReportFilter(req) {
  const query = {};
  if (req.query.attractionId) query.attractionId = req.query.attractionId;
  const st = String(req.query.status || "").trim();
  if (st === "signed" || st === "revoked") query.status = st;
  if (req.query.from || req.query.to) {
    query.createdAt = {};
    if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
  }
  const q = String(req.query.q || "").trim();
  if (q) {
    const safe = escapeRegex(q);
    query.$or = [
      { "participant.fullName": { $regex: safe, $options: "i" } },
      { "participant.email": { $regex: safe, $options: "i" } }
    ];
  }
  return query;
}

function csvCell(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function mapWaiverRow(w) {
  return {
    id: w._id,
    attractionId: w.attractionId,
    attractionName: w.attractionName,
    fullName: w.participant?.fullName,
    email: w.participant?.email,
    phone: w.participant?.phone,
    birthDate: w.participant?.birthDate,
    emergencyContactName: w.participant?.emergencyContactName,
    emergencyContactPhone: w.participant?.emergencyContactPhone,
    nationality: w.participant?.nationality || "",
    cityState: w.participant?.cityState || "",
    medications: w.participant?.medications || "",
    treatingPhysician: w.participant?.treatingPhysician || "",
    physicianPhone: w.participant?.physicianPhone || "",
    emergencyContactRelationship: w.participant?.emergencyContactRelationship || "",
    familyReference2Name: w.participant?.familyReference2Name || "",
    familyReference2Relationship: w.participant?.familyReference2Relationship || "",
    familyReference2Phone: w.participant?.familyReference2Phone || "",
    isMinor: w.isMinor,
    guardianFullName: w.guardian?.fullName || "",
    guardianRelation: w.guardian?.relation || "",
    guardianPhone: w.guardian?.phone || "",
    guardianEmail: w.guardian?.email || "",
    hasMedicalCondition: w.answers?.hasMedicalCondition,
    consumedAlcoholOrDrugs: w.answers?.consumedAlcoholOrDrugs,
    acceptsSafetyRules: w.answers?.acceptsSafetyRules,
    status: w.status,
    qrConsumedAt: w.qrConsumedAt || null,
    createdAt: w.createdAt
  };
}

export function adminRoutes({ jwtSecret }) {
  const router = Router();

  router.use(requireAuth(jwtSecret), requireRoles("admin"));

  router.get("/attractions", async (_req, res) => {
    const items = await Attraction.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  });

  router.post("/attractions", async (req, res) => {
    const { name, code, description, waiverText, active = true, stripeEnabled = false } = req.body ?? {};
    if (!name || !code) return res.status(400).json({ error: "Nombre y código son obligatorios." });

    const created = await Attraction.create({
      name,
      code: String(code).toUpperCase(),
      description: description ?? "",
      waiverText,
      active,
      stripeEnabled: stripeEnabled === true
    });
    res.status(201).json(created);
  });

  router.patch("/attractions/:id", async (req, res) => {
    const payload = { ...req.body };
    if (payload.code) payload.code = String(payload.code).toUpperCase();
    const updated = await Attraction.findByIdAndUpdate(req.params.id, payload, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: "Atracción no encontrada." });
    res.json(updated);
  });

  router.get("/waivers", async (req, res) => {
    const query = {};
    if (req.query.attractionId) query.attractionId = req.query.attractionId;
    const waivers = await Waiver.find(query).sort({ createdAt: -1 }).limit(200).lean();
    res.json(waivers);
  });

  router.patch("/waivers/:id/revoke", async (req, res) => {
    const updated = await Waiver.findByIdAndUpdate(
      req.params.id,
      { status: "revoked" },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: "Waiver no encontrado." });
    res.json(updated);
  });

  router.get("/reports/waivers", async (req, res) => {
    const filter = waiverAdminReportFilter(req);
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize || "25"), 10) || 25;
    const pageSize = Math.min(200, Math.max(1, pageSizeRaw));

    const countAt = nowMs();
    const total = await Waiver.countDocuments(filter);
    perfLog("db_query", {
      operation: "admin_reports_waivers_count",
      durationMs: nowMs() - countAt
    });
    let signedCount = 0;
    let revokedCount = 0;
    if (filter.status) {
      signedCount = filter.status === "signed" ? total : 0;
      revokedCount = filter.status === "revoked" ? total : 0;
    } else {
      const statusCountsAt = nowMs();
      [signedCount, revokedCount] = await Promise.all([
        Waiver.countDocuments({ ...filter, status: "signed" }),
        Waiver.countDocuments({ ...filter, status: "revoked" })
      ]);
      perfLog("db_query", {
        operation: "admin_reports_waivers_status_counts",
        durationMs: nowMs() - statusCountsAt
      });
    }

    const listAt = nowMs();
    const raw = await Waiver.find(filter)
      .select(waiverSelectLean)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();
    perfLog("db_query", {
      operation: "admin_reports_waivers_list",
      durationMs: nowMs() - listAt
    });

    res.json({
      summary: { total, signed: signedCount, revoked: revokedCount },
      page,
      pageSize,
      total,
      items: raw.map(mapWaiverRow)
    });
  });

  router.get("/reports/waivers/export.csv", async (req, res) => {
    const filter = waiverAdminReportFilter(req);
    const exportAt = nowMs();
    const rows = await Waiver.find(filter)
      .select(waiverSelectLean)
      .sort({ createdAt: -1 })
      .limit(MAX_CSV_ROWS)
      .lean();
    perfLog("db_query", {
      operation: "admin_reports_waivers_export",
      durationMs: nowMs() - exportAt
    });

    const headers = [
      "id",
      "attractionId",
      "attractionName",
      "fullName",
      "email",
      "phone",
      "birthDate",
      "emergencyContactName",
      "emergencyContactPhone",
      "nationality",
      "cityState",
      "medications",
      "treatingPhysician",
      "physicianPhone",
      "emergencyContactRelationship",
      "familyReference2Name",
      "familyReference2Relationship",
      "familyReference2Phone",
      "isMinor",
      "guardianFullName",
      "guardianRelation",
      "guardianPhone",
      "guardianEmail",
      "hasMedicalCondition",
      "consumedAlcoholOrDrugs",
      "acceptsSafetyRules",
      "status",
      "qrConsumedAt",
      "createdAt"
    ];
    const lines = [headers.join(",")];
    for (const w of rows) {
      const r = mapWaiverRow(w);
      lines.push(
        [
          csvCell(r.id),
          csvCell(r.attractionId),
          csvCell(r.attractionName),
          csvCell(r.fullName),
          csvCell(r.email),
          csvCell(r.phone),
          csvCell(r.birthDate),
          csvCell(r.emergencyContactName),
          csvCell(r.emergencyContactPhone),
          csvCell(r.nationality),
          csvCell(r.cityState),
          csvCell(r.medications),
          csvCell(r.treatingPhysician),
          csvCell(r.physicianPhone),
          csvCell(r.emergencyContactRelationship),
          csvCell(r.familyReference2Name),
          csvCell(r.familyReference2Relationship),
          csvCell(r.familyReference2Phone),
          csvCell(r.isMinor),
          csvCell(r.guardianFullName),
          csvCell(r.guardianRelation),
          csvCell(r.guardianPhone),
          csvCell(r.guardianEmail),
          csvCell(r.hasMedicalCondition),
          csvCell(r.consumedAlcoholOrDrugs),
          csvCell(r.acceptsSafetyRules),
          csvCell(r.status),
          csvCell(r.qrConsumedAt ? new Date(r.qrConsumedAt).toISOString() : ""),
          csvCell(r.createdAt ? new Date(r.createdAt).toISOString() : "")
        ].join(",")
      );
    }

    const body = `\uFEFF${lines.join("\n")}`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="waivers-reporte.csv"');
    res.send(body);
  });

  router.get("/users", async (_req, res) => {
    const users = await User.find().sort({ createdAt: -1 }).select("-passwordHash").lean();
    res.json(users);
  });

  router.post("/users", async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "");
    const role = req.body?.role;

    if (!name || !email || !password || !["admin", "staff"].includes(role)) {
      return res.status(400).json({ error: "Datos de usuario inválidos." });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: "Ese correo ya está registrado." });

    const passwordHash = await bcrypt.hash(password, 10);
    const created = await User.create({ name, email, passwordHash, role, active: true });
    res.status(201).json({
      id: created._id,
      name: created.name,
      email: created.email,
      role: created.role,
      active: created.active
    });
  });

  router.patch("/users/:id", async (req, res) => {
    const payload = {};
    if (typeof req.body?.name === "string") payload.name = req.body.name.trim();
    if (typeof req.body?.active === "boolean") payload.active = req.body.active;
    if (typeof req.body?.role === "string" && ["admin", "staff"].includes(req.body.role)) {
      payload.role = req.body.role;
    }
    if (typeof req.body?.password === "string" && req.body.password.length >= 6) {
      payload.passwordHash = await bcrypt.hash(req.body.password, 10);
    }

    const updated = await User.findByIdAndUpdate(req.params.id, payload, { new: true })
      .select("-passwordHash")
      .lean();
    if (!updated) return res.status(404).json({ error: "Usuario no encontrado." });
    res.json(updated);
  });

  return router;
}
