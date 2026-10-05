import { additionalStaffRoutes } from "./additionalStaff.js";
import { Router } from "express";
import { requireAuth, requirePermissions, requireRoles } from "../lib/auth.js";
import { Waiver } from "../models/Waiver.js";
import { Attraction } from "../models/Attraction.js";
import { verifyWaiverToken } from "../lib/token.js";
import { nowMs, perfLog } from "../lib/perf.js";
import { waiverDisplayId } from "../lib/folio.js";
import { getWaiverQrExpiresAt, isWaiverQrExpired } from "../lib/waiverValidity.js";
import { WaiverAuditEvent } from "../models/WaiverAuditEvent.js";
import { waiverAlerts, weightRangeFor } from "../lib/waiverAlerts.js";

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
    ,safetyVerification: waiver.safetyVerification || null
    ,alerts: waiverAlerts(waiver, { name: waiver.attractionName })
  };
}
import { parkDateTime } from "../../../shared/visitSchedule.js";
import { visitQrResult } from "../lib/visitQr.js";

function staffVisitResult(waiver) {
  const result = visitQrResult(waiver);
  if (result.valid) {
    result.waiver = { ...mapStaffWaiver(waiver), ...result.waiver };
    result.review = {
      participant: waiver.participant,
      isMinor: waiver.isMinor,
      guardian: waiver.guardian,
      answers: waiver.answers,
      signatureImage: waiver.signatureImage,
      witness: waiver.witness,
      waiverTextSnapshot: waiver.waiverTextSnapshot
    };
  }
  return result;
}

export function reportRoutes({ jwtSecret }) {
  const router = Router();
  router.use(requireAuth(jwtSecret), requireRoles("admin", "staff"));
  router.use(additionalStaffRoutes({ jwtSecret }));

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
    if (decision === "approved") {
      waiver.validatedAt = waiver.review.reviewedAt;
      waiver.validatedBy = req.user._id;
    }
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
        reviewedAt: waiver.review.reviewedAt,
        validatedBy: waiver.validatedBy,
        validatedAt: waiver.validatedAt
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
      if (waiver.status !== "approved") return res.status(409).json({ error: "La carta debe estar validada antes de asignar horario." });
      if (![String(waiver.attractionId), ...(waiver.attractionIds || []).map(String)].includes(attractionId)) {
        return res.status(400).json({ error: "La atracción no pertenece al waiver." });
      }

      const attractionIndex = (waiver.attractionIds || []).findIndex(id => String(id) === attractionId);
      const attractionName = attractionIndex >= 0
        ? (waiver.attractionNames || [])[attractionIndex] || waiver.attractionName
        : waiver.attractionName;
      const assignedAt = parkDateTime(date, time);
      if (!assignedAt || assignedAt.getTime() < Date.now()) return res.status(400).json({ error: "El horario debe ser válido y futuro." });
      waiver.schedule = { date, group, time, attractionId, attractionName, assignedBy: req.user._id, assignedAt: new Date() };
      waiver.assignedAt = assignedAt;
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

  router.post("/waivers/:id/weight-verification", requirePermissions("waiver.review", "waiver.comment"), async (req, res) => {
    const weight = Number(req.body?.weight);
    const comment = String(req.body?.comment || "").trim();
    const attractionId = String(req.body?.attractionId || "").trim();
    if (!Number.isFinite(weight) || weight <= 0 || weight > 300) return res.status(400).json({ error: "El peso debe estar entre 0 y 300 kg." });
    const waiver = await Waiver.findOne({ _id: req.params.id, deletedAt: null, status: { $in: ["pending", "approved"] } });
    if (!waiver) return res.status(404).json({ error: "Carta no encontrada o no disponible." });
    if (!attractionId || ![String(waiver.attractionId), ...(waiver.attractionIds || []).map(String)].includes(attractionId)) return res.status(400).json({ error: "La atracción es obligatoria y debe pertenecer al waiver." });
    const attraction = await Attraction.findOne({ _id: attractionId }).lean();
    if (!attraction) return res.status(400).json({ error: "La atracción no existe." });
    const range = weightRangeFor(attraction);
    const status = range && (weight < range.min || weight > range.max) ? "outside_range" : "within_range";
    waiver.safetyVerification = { ...(waiver.safetyVerification || {}), weightVerified: weight, weightStatus: status, comments: comment, checkedBy: req.user._id, checkedAt: new Date() };
    await waiver.save();
    await WaiverAuditEvent.create({ waiverId: waiver._id, userId: req.user._id, userRole: req.user.role, action: "weight_verified", comment, metadata: { weight, status } });
    return res.json({ ok: true, attraction: { id: attraction._id, name: attraction.name, code: attraction.code }, safetyVerification: waiver.safetyVerification, alerts: waiverAlerts(waiver, attraction) });
  });

  router.get("/pending", requirePermissions("waiver.read.scanned"), async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const rows = await Waiver.find({ deletedAt: null, status: { $in: ["pending", "signed"] }, ...(req.query.visitDate ? { visitDate: String(req.query.visitDate) } : {}) }).sort({ visitDate: 1, createdAt: 1 }).limit(limit).lean();
    return res.json({ items: rows.map(mapStaffWaiver), total: rows.length });
  });

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
      if (waiver.visitDate && isWaiverQrExpired(waiver)) return res.status(409).json({ error: "Carta vencida." });
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
          qrToken: waiver.qrToken || qrToken,
          qrUrl: waiver.qrUrl || ""
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

    // No existe, fue revocado o rechazado.
    if (!waiver || ["revoked", "rejected"].includes(waiver.status)) {
      return res.status(404).json({
        valid: false,
        error: "Waiver inválido o revocado."
      });
    }

    // Flujo NUEVO de visitas programadas.
    // Estos QR no se consumen; visitQrResult determina si hay acceso.
    if (waiver.visitDate) {
      return res.json(staffVisitResult(waiver));
    }

      if (["pending", "signed"].includes(waiver.status)) {
        return res.json({
          valid: true,
          requiresReview: true,
          waiver: mapStaffWaiver({ ...waiver, status: "pending" })
        });
      }
    // A partir de aquí estamos en el flujo LEGACY,
    // porque el waiver no tiene visitDate.

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

        if (false) {
          return res.status(404).json({ valid: false, error: "Waiver inválido o revocado." });
        }
    // Los QR legacy conservan su comportamiento de un solo uso.
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
      {
        _id: waiverId,
        status: { $in: ["approved", "signed"] },
        qrConsumedAt: null
      },
      {
        $set: {
          qrConsumedAt: new Date()
        }
      },
      { new: true }
    ).lean();

    perfLog("db_query", {
      operation: "reports_validate_consume_qr",
      durationMs: nowMs() - consumeAt
    });

    // Otro Staff pudo consumirlo entre la lectura y el update.
    if (!consumed) {
      const secondLookupAt = nowMs();
      const again = await Waiver.findById(waiverId).lean();

      perfLog("db_query", {
        operation: "reports_validate_find_by_id_retry",
        durationMs: nowMs() - secondLookupAt
      });

      if (!again || ["revoked", "rejected"].includes(again.status)) {
        return res.status(404).json({
          valid: false,
          error: "Waiver inválido o revocado."
        });
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
      waiver: {
        databaseId: consumed._id,
        id: waiverDisplayId(consumed),
        attractionName: consumed.attractionName,
        fullName: consumed.participant.fullName,
        birthDate: consumed.participant.birthDate,
        signedAt: consumed.createdAt,
        status: consumed.status,
        review: consumed.review || null
      }
    });
  } catch (_error) {
    return res.status(400).json({
      valid: false,
      error: "Token inválido."
    });
  }
});

// Explicit Staff action: reading/scanning a new QR never approves or consumes it.
router.post("/validate/:token", requirePermissions("waiver.scan"), async (req, res) => {
  let payload;

  try {
    payload = verifyWaiverToken(req.params.token, jwtSecret);
  } catch {
    return res.status(400).json({ error: "Token inválido." });
  }

  try {
    const waiver = await Waiver.findOne({ _id: payload.waiverId, deletedAt: null }).lean();

    if (!waiver || ["revoked", "rejected"].includes(waiver.status)) {
      return res.status(404).json({
        error: "Waiver inválido, rechazado o revocado."
      });
    }

    if (!waiver.visitDate || !["pending", "signed"].includes(waiver.status)) {
      return res.status(409).json({
        error: "La carta ya fue validada o no pertenece al flujo de visitas."
      });
    }

    const assignedAt = parkDateTime(
      waiver.visitDate,
      req.body?.assignedTime
    );

    if (
      !req.body?.assignedTime ||
      !assignedAt ||
      assignedAt.getTime() < Date.now()
    ) {
      return res.status(400).json({
        error: "Indica una hora válida, no pasada, del día de visita (hora del parque)."
      });
    }

    const reviewedAt = new Date();

    const updated = await Waiver.findOneAndUpdate(
      {
        _id: waiver._id,
        status: { $in: ["pending", "signed"] },
        visitDate: waiver.visitDate
      },
      {
        $set: {
          assignedAt,
          status: "approved",
          validatedAt: reviewedAt,
          validatedBy: req.user._id,

          "review.decision": "approved",
          "review.comment": "",
          "review.reviewedBy": req.user._id,
          "review.reviewedAt": reviewedAt
        }
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(409).json({
        error: "La carta cambió. Consulta nuevamente el QR."
      });
    }

    await WaiverAuditEvent.create({
      waiverId: updated._id,
      userId: req.user._id,
      userRole: req.user.role,
      action: "approved",
      metadata: {
        source: "staff_visit_validation",
        assignedAt
      }
    });

    return res.json(staffVisitResult(updated));
  } catch (error) {
    console.error("Validación de visita:", error.message);
    return res.status(500).json({
      error: "No se pudo validar la visita."
    });
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
      visitDate: w.visitDate,
      assignedAt: w.assignedAt,
      createdAt: w.createdAt
    }))
  });
  });

  return router;
}
