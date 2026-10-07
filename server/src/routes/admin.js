import { isWaiverQrExpired, qrWriteGuard } from "../lib/waiverValidity.js";
import { activitySummaries } from "../lib/additionalActivities.js";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { Attraction } from "../models/Attraction.js";
import { Waiver } from "../models/Waiver.js";
import { User } from "../models/User.js";
import { requireAuth, requirePermissions, requireRoles } from "../lib/auth.js";
import { nowMs, perfLog } from "../lib/perf.js";
import { waiverDisplayId } from "../lib/folio.js";
import { WaiverAuditEvent } from "../models/WaiverAuditEvent.js";

const MAX_CSV_ROWS = 50000;
const waiverSelectLean =
  "-signatureImage -guardian.signatureImage -witness.signatureImage -waiverTextSnapshot";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function waiverAdminReportFilter(req) {
  const query = { deletedAt: null };
  if (req.query.attractionId) query.attractionId = req.query.attractionId;
  const st = String(req.query.status || "").trim();
  if (["pending", "approved", "rejected", "revoked"].includes(st)) {
    query.status = st === "pending" ? { $in: ["pending", "signed"] } : st;
  }
  if (req.query.from || req.query.to) {
    query.createdAt = {};
    if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
  }
  const period = String(req.query.period || "").trim();
  if (["previous", "active", "upcoming"].includes(period)) {
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chihuahua" }).format(now);
    if (period === "previous") query.visitDate = { $lt: today };
    if (period === "active") query.visitDate = today;
    if (period === "upcoming") query.visitDate = { $gt: today };
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
    additionalActivities: activitySummaries(w),
    databaseId: w._id,
    id: waiverDisplayId(w),
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
    status: w.status === "signed" ? "pending" : w.status,
    visitDate: w.visitDate || "",
    assignedAt: w.assignedAt || null,
    scheduleAssignedAt: w.scheduleAssignedAt || null,
    qrExpiresAt: w.qrExpiresAt || null,
    validatedAt: w.validatedAt || null,
    validatedBy: w.validatedBy || "",
    qrConsumedAt: w.qrConsumedAt || null,
    createdAt: w.createdAt,
  };
}

export function adminRoutes({ jwtSecret }) {
  const router = Router();

  router.use(requireAuth(jwtSecret), requireRoles("admin"), requirePermissions("admin.panel"));

  router.get("/attractions", async (_req, res) => {
    const items = await Attraction.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  });

  router.post("/attractions", async (req, res) => {
    const { name, code, description, waiverText, active = true, stripeEnabled = false } = req.body ?? {};
    if (!name || !code) return res.status(400).json({ error: "Nombre y código son obligatorios." });
    const waiverPlain = String(waiverText || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!waiverPlain) return res.status(400).json({ error: "El texto del waiver es obligatorio." });

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
    if (payload.waiverText !== undefined) {
      const waiverPlain = String(payload.waiverText || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!waiverPlain) return res.status(400).json({ error: "El texto del waiver es obligatorio." });
    }
    const updated = await Attraction.findByIdAndUpdate(req.params.id, payload, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: "Atracción no encontrada." });
    res.json(updated);
  });

  router.get("/waivers", async (req, res) => {
    const query = { deletedAt: null };
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
    await WaiverAuditEvent.create({
      waiverId: updated._id,
      userId: req.user._id,
      userRole: req.user.role,
      action: "revoked",
      comment: String(req.body?.comment || "").trim()
    });
    res.json(updated);
  });

  router.delete("/waivers/:id", async (req, res) => {
    const comment = String(req.body?.comment || "").trim();
    const waiver = await Waiver.findOne({ _id: req.params.id, deletedAt: null });
    if (!waiver) return res.status(404).json({ error: "Waiver no encontrado." });

    waiver.deletedAt = new Date();
    waiver.deletedBy = req.user._id;
    await waiver.save();
    await WaiverAuditEvent.create({
      waiverId: waiver._id,
      userId: req.user._id,
      userRole: req.user.role,
      action: "waiver_deleted",
      comment,
      metadata: { source: "admin_delete", logical: true }
    });
    return res.json({ ok: true, waiver: { id: waiverDisplayId(waiver), deletedAt: waiver.deletedAt } });
  });

  router.patch("/waivers/:id/status", async (req, res) => {
    const nextStatus = String(req.body?.status || "").trim();
    const comment = String(req.body?.comment || "").trim();
    const allowedStatuses = ["pending", "approved", "rejected", "revoked"];

    if (!allowedStatuses.includes(nextStatus)) return res.status(400).json({ error: "Estado inválido." });
    if (nextStatus === "rejected" && !comment) {
      return res.status(400).json({ error: "El comentario es obligatorio al rechazar." });
    }
    if (comment.length > 1000) return res.status(400).json({ error: "El comentario no puede exceder 1000 caracteres." });

    const waiver = await Waiver.findById(req.params.id);
    if (!waiver) return res.status(404).json({ error: "Waiver no encontrado." });

    if (isWaiverQrExpired(waiver) || (["revoked", "rejected"].includes(waiver.status) && nextStatus !== waiver.status)) {
      return res.status(409).json({ error: "Un QR vencido o desactivado no puede reactivarse." });
    }
    const previousStatus = waiver.status;
    waiver.status = nextStatus;
    if (["approved", "rejected"].includes(nextStatus)) {
      waiver.review = { decision: nextStatus, comment, reviewedBy: req.user._id, reviewedAt: new Date() };
    }
    const updated = await Waiver.findOneAndUpdate({ _id: waiver._id, status: previousStatus, ...qrWriteGuard(waiver) }, { $set: { status: nextStatus, review: waiver.review } }, { new: true }).lean();
    if (!updated) return res.status(409).json({ error: "Carta modificada o vencida." });
    await WaiverAuditEvent.create({
      waiverId: waiver._id,
      userId: req.user._id,
      userRole: req.user.role,
      action: "status_changed",
      comment,
      metadata: { from: previousStatus, to: nextStatus }
    });
    if (comment) {
      await WaiverAuditEvent.create({
        waiverId: waiver._id,
        userId: req.user._id,
        userRole: req.user.role,
        action: "comment_added",
        comment,
        metadata: { source: "status_change" }
      });
    }

    return res.json({ ok: true, waiver: { id: waiverDisplayId(waiver), status: waiver.status, review: waiver.review || null } });
  });

  router.get("/waivers/:id/history", async (req, res) => {
    const waiver = await Waiver.findById(req.params.id).select("_id folio").lean();
    if (!waiver) return res.status(404).json({ error: "Waiver no encontrado." });

    const events = await WaiverAuditEvent.find({ waiverId: waiver._id })
      .populate("userId", "name email role")
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      waiverId: waiver._id,
      folio: waiver.folio,
      events
    });
  });

  router.get("/waivers/:id/record", async (req, res) => {
    const current = await Waiver.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Waiver no encontrado." });

    const email = String(current.participant?.email || "").trim().toLowerCase();
    const visits = await Waiver.find(email ? { "participant.email": email } : { _id: current._id })
      .select("_id folio attractionName status createdAt schedule review")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      visitor: {
        fullName: current.participant?.fullName || "",
        email: current.participant?.email || "",
        phone: current.participant?.phone || "",
        cityState: current.participant?.cityState || ""
      },
      currentWaiverId: current._id,
      visits
    });
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
    let pendingCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let revokedCount = 0;
    if (filter.status) {
    const isPendingFilter =
      typeof filter.status === "object" &&
      Array.isArray(filter.status.$in) &&
      filter.status.$in.includes("pending");

      pendingCount = isPendingFilter ? total : 0;
      approvedCount = filter.status === "approved" ? total : 0;
      rejectedCount = filter.status === "rejected" ? total : 0;
      revokedCount = filter.status === "revoked" ? total : 0;
    } else {
      const statusCountsAt = nowMs();
      [pendingCount, approvedCount, rejectedCount, revokedCount] = await Promise.all([
        Waiver.countDocuments({ ...filter, status: { $in: ["pending", "signed"] } }),
        Waiver.countDocuments({ ...filter, status: "approved" }),
        Waiver.countDocuments({ ...filter, status: "rejected" }),
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
    summary: {
      total,
      pending: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
      revoked: revokedCount
    },
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
      "visitDate",
      "assignedAt",
      "scheduleAssignedAt",
      "qrExpiresAt",
      "validatedAt",
      "validatedBy",
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
          csvCell(r.visitDate),
          csvCell(r.assignedAt ? new Date(r.assignedAt).toISOString() : ""),
          csvCell(r.scheduleAssignedAt ? new Date(r.scheduleAssignedAt).toISOString() : ""),
          csvCell(r.qrExpiresAt ? new Date(r.qrExpiresAt).toISOString() : ""),
          csvCell(r.validatedAt ? new Date(r.validatedAt).toISOString() : ""),
          csvCell(r.validatedBy),
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
