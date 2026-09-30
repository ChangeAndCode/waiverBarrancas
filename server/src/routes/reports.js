import { Router } from "express";
import { requireAuth, requirePermissions, requireRoles } from "../lib/auth.js";
import { Waiver } from "../models/Waiver.js";
import { verifyWaiverToken } from "../lib/token.js";
import { nowMs, perfLog } from "../lib/perf.js";
import { waiverDisplayId } from "../lib/folio.js";
import { getWaiverQrExpiresAt, isWaiverQrExpired } from "../lib/waiverValidity.js";
import { WaiverAuditEvent } from "../models/WaiverAuditEvent.js";

function mapStaffWaiver(waiver) {
  return {
    databaseId: waiver._id,
    id: waiverDisplayId(waiver),
    attractionId: waiver.attractionId,
    attractionName: waiver.attractionName,
    attractionNames: waiver.attractionNames || [],
    fullName: waiver.participant?.fullName || "",
    birthDate: waiver.participant?.birthDate || "",
    participant: waiver.participant,
    isMinor: waiver.isMinor,
    guardian: waiver.guardian
      ? {
          fullName: waiver.guardian.fullName,
          relation: waiver.guardian.relation,
          phone: waiver.guardian.phone,
          email: waiver.guardian.email
        }
      : null,
    answers: waiver.answers,
    acceptedText: waiver.acceptedText,
    signatureName: waiver.signatureName,
    hasSignature: Boolean(waiver.signatureImage),
    witness: { hasSignature: Boolean(waiver.witness?.signatureImage) },
    waiverTextSnapshot: waiver.waiverTextSnapshot,
    schedule: waiver.schedule || null,
    signedAt: waiver.createdAt,
    status: waiver.status === "signed" ? "pending" : waiver.status,
    review: waiver.review || null
  };
}

export function reportRoutes({ jwtSecret }) {
  const router = Router();
  router.use(requireAuth(jwtSecret), requireRoles("admin", "staff"));

  router.post(
    "/waivers/:id/review",
    requirePermissions("waiver.review", "waiver.comment"),
    async (req, res) => {
    const decision = String(req.body?.decision || "").trim();
    const comment = String(req.body?.comment || "").trim();

    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "La decisión debe ser approved o rejected." });
    }
    if (decision === "rejected" && !comment) {
      return res.status(400).json({ error: "El comentario es obligatorio al rechazar un waiver." });
    }
    if (comment.length > 1000) {
      return res.status(400).json({ error: "El comentario no puede exceder 1000 caracteres." });
    }

    const waiver = await Waiver.findOne({ _id: req.params.id, deletedAt: null, status: { $in: ["pending", "signed"] } });
    if (!waiver) {
      return res.status(404).json({ error: "Waiver no encontrado o revocado." });
    }

    waiver.review = {
      decision,
      comment,
      reviewedBy: req.user._id,
      reviewedAt: new Date()
    };
    waiver.status = decision;
    await waiver.save();
    await WaiverAuditEvent.create({
      waiverId: waiver._id,
      userId: req.user._id,
      userRole: req.user.role,
      action: decision,
      comment
    });
    if (comment) {
      await WaiverAuditEvent.create({
        waiverId: waiver._id,
        userId: req.user._id,
        userRole: req.user.role,
        action: "comment_added",
        comment,
        metadata: { source: "review" }
      });
    }

    return res.json({
      ok: true,
      waiver: {
        id: waiverDisplayId(waiver),
        status: waiver.status,
        decision: waiver.review.decision,
        comment: waiver.review.comment,
        reviewedBy: waiver.review.reviewedBy,
        reviewedAt: waiver.review.reviewedAt
      }
    });
    }
  );

  router.patch(
    "/waivers/:id/schedule",
    requirePermissions("waiver.schedule.assign"),
    async (req, res) => {
      const qrToken = String(req.body?.qrToken || "").trim();
      const date = String(req.body?.date || "").trim();
      const group = String(req.body?.group || "").trim();
      const time = String(req.body?.time || "").trim();
      const attractionId = String(req.body?.attractionId || "").trim();

      if (!qrToken || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !group || !time || !attractionId) {
        return res.status(400).json({ error: "Fecha, grupo, horario, atracción y QR son obligatorios." });
      }

      let payload;
      try {
        payload = verifyWaiverToken(qrToken, jwtSecret);
      } catch (_error) {
        return res.status(400).json({ error: "QR inválido." });
      }
      if (String(payload.waiverId) !== String(req.params.id)) {
        return res.status(403).json({ error: "El QR no corresponde al waiver." });
      }

      const waiver = await Waiver.findOne({ _id: req.params.id, deletedAt: null });
      if (!waiver || ["revoked", "rejected"].includes(waiver.status)) {
        return res.status(404).json({ error: "Waiver no encontrado o no disponible." });
      }
      if (![String(waiver.attractionId), ...(waiver.attractionIds || []).map(String)].includes(attractionId)) {
        return res.status(400).json({ error: "La atracción no pertenece al waiver." });
      }

      const attractionName = waiver.attractionName;
      waiver.schedule = { date, group, time, attractionId, attractionName, assignedBy: req.user._id, assignedAt: new Date() };
      await waiver.save();
      await WaiverAuditEvent.create({
        waiverId: waiver._id,
        userId: req.user._id,
        userRole: req.user.role,
        action: "schedule_assigned",
        metadata: { date, group, time, attractionId, attractionName }
      });
      return res.json({ ok: true, waiver: { id: waiverDisplayId(waiver), schedule: waiver.schedule } });
    }
  );

  router.post(
    "/waivers/:id/ticket",
    requirePermissions("waiver.ticket.print"),
    async (req, res) => {
      const qrToken = String(req.body?.qrToken || "").trim();
      if (!qrToken) return res.status(400).json({ error: "El QR es obligatorio." });

      let payload;
      try {
        payload = verifyWaiverToken(qrToken, jwtSecret);
      } catch (_error) {
        return res.status(400).json({ error: "QR inválido." });
      }
      if (String(payload.waiverId) !== String(req.params.id)) {
        return res.status(403).json({ error: "El QR no corresponde al waiver." });
      }

      const waiver = await Waiver.findOne({ _id: req.params.id, deletedAt: null }).lean();
      if (!waiver || ["revoked", "rejected"].includes(waiver.status)) {
        return res.status(404).json({ error: "Waiver no encontrado o no disponible." });
      }
      if (waiver.status !== "approved") {
        return res.status(409).json({ error: "El waiver debe estar aprobado para imprimir el ticket." });
      }
      if (!waiver.schedule?.date || !waiver.schedule?.time || !waiver.schedule?.group) {
        return res.status(409).json({ error: "Primero asigna un horario al waiver." });
      }

      await WaiverAuditEvent.create({
        waiverId: waiver._id,
        userId: req.user._id,
        userRole: req.user.role,
        action: "ticket_printed",
        metadata: { source: "staff_ticket", folio: waiverDisplayId(waiver) }
      });

      return res.json({
        ok: true,
        ticket: {
          id: waiverDisplayId(waiver),
          fullName: waiver.participant.fullName,
          attractionName: waiver.schedule.attractionName || waiver.attractionName,
          date: waiver.schedule.date,
          time: waiver.schedule.time,
          group: waiver.schedule.group,
          cityState: waiver.participant.cityState || "",
          qrToken
        }
      });
    }
  );

  router.get("/validate/:token", requirePermissions("waiver.scan"), async (req, res) => {
    try {
      const payload = verifyWaiverToken(req.params.token, jwtSecret);
      const waiverId = payload.waiverId;

      const firstLookupAt = nowMs();
      const waiver = await Waiver.findOne({ _id: waiverId, deletedAt: null }).lean();
      perfLog("db_query", {
        operation: "reports_validate_find_by_id",
        durationMs: nowMs() - firstLookupAt
      });
      if (!waiver || ["revoked", "rejected"].includes(waiver.status)) {
        return res.status(404).json({ valid: false, error: "Waiver inválido o revocado." });
      }

      if (isWaiverQrExpired(waiver)) {
        return res.json({
          valid: false,
          reason: "qr_expired",
          signedAt: waiver.createdAt,
          expiresAt: getWaiverQrExpiresAt(waiver.createdAt),
          attractionName: waiver.attractionName,
          fullName: waiver.participant.fullName
        });
      }

      if (["pending", "signed"].includes(waiver.status)) {
        return res.json({
          valid: true,
          requiresReview: true,
          waiver: mapStaffWaiver({ ...waiver, status: "pending" })
        });
      }

      if (waiver.qrConsumedAt) {
        return res.json({
          valid: false,
          reason: "qr_already_used",
          usedAt: waiver.qrConsumedAt,
          attractionName: waiver.attractionName,
          fullName: waiver.participant.fullName
        });
      }

      const consumeAt = nowMs();
      const consumed = await Waiver.findOneAndUpdate(
        { _id: waiverId, status: "approved", qrConsumedAt: null },
        { $set: { qrConsumedAt: new Date() } },
        { new: true }
      ).lean();
      perfLog("db_query", {
        operation: "reports_validate_consume_qr",
        durationMs: nowMs() - consumeAt
      });

      if (!consumed) {
        const secondLookupAt = nowMs();
        const again = await Waiver.findOne({ _id: waiverId, deletedAt: null }).lean();
        perfLog("db_query", {
          operation: "reports_validate_find_by_id_retry",
          durationMs: nowMs() - secondLookupAt
        });
        if (!again || ["revoked", "rejected"].includes(again.status)) {
          return res.status(404).json({ valid: false, error: "Waiver inválido o revocado." });
        }
        return res.json({
          valid: false,
          reason: "qr_already_used",
          usedAt: again.qrConsumedAt,
          attractionName: again.attractionName,
          fullName: again.participant.fullName
        });
      }

      await WaiverAuditEvent.create({
        waiverId: consumed._id,
        userId: req.user._id,
        userRole: req.user.role,
        action: "qr_validated",
        metadata: { source: "staff_validation" }
      });

      return res.json({
        valid: true,
        waiver: mapStaffWaiver(consumed)
      });
    } catch (_error) {
      return res.status(400).json({ valid: false, error: "Token inválido." });
    }
  });

  router.get("/waivers", requireRoles("admin"), async (req, res) => {
    const query = {};
    if (req.query.attractionId) query.attractionId = req.query.attractionId;
    if (req.query.from || req.query.to) {
      query.createdAt = {};
      if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
    }

    const waiversAt = nowMs();
    const waivers = await Waiver.find(query).sort({ createdAt: -1 }).limit(300).lean();
    perfLog("db_query", {
      operation: "reports_waivers_list",
      durationMs: nowMs() - waiversAt
    });
    const total = waivers.length;
    const pending = waivers.filter((w) => ["pending", "signed"].includes(w.status)).length;
    const approved = waivers.filter((w) => w.status === "approved").length;
    const rejected = waivers.filter((w) => w.status === "rejected").length;
    const revoked = waivers.filter((w) => w.status === "revoked").length;

    const byAttraction = Object.values(
      waivers.reduce((acc, item) => {
        if (!acc[item.attractionName]) {
          acc[item.attractionName] = { attractionName: item.attractionName, count: 0 };
        }
        acc[item.attractionName].count += 1;
        return acc;
      }, {})
    );

    res.json({
      summary: { total, pending, approved, rejected, revoked },
      byAttraction,
      waivers: waivers.map((w) => ({
        id: waiverDisplayId(w),
        attractionName: w.attractionName,
        fullName: w.participant.fullName,
        email: w.participant.email,
        status: w.status === "signed" ? "pending" : w.status,
        createdAt: w.createdAt
      }))
    });
  });

  return router;
}
