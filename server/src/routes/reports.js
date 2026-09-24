import { Router } from "express";
import { requireAuth, requireRoles } from "../lib/auth.js";
import { Waiver } from "../models/Waiver.js";
import { verifyWaiverToken } from "../lib/token.js";
import { nowMs, perfLog } from "../lib/perf.js";
import { waiverDisplayId } from "../lib/folio.js";
import { getWaiverQrExpiresAt, isWaiverQrExpired } from "../lib/waiverValidity.js";
import { WaiverAuditEvent } from "../models/WaiverAuditEvent.js";

export function reportRoutes({ jwtSecret }) {
  const router = Router();
  router.use(requireAuth(jwtSecret), requireRoles("admin", "staff"));

  router.post("/waivers/:id/review", async (req, res) => {
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

    const waiver = await Waiver.findOne({ _id: req.params.id, status: "pending" });
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
      action: decision,
      comment
    });

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
  });

  router.get("/validate/:token", async (req, res) => {
    try {
      const payload = verifyWaiverToken(req.params.token, jwtSecret);
      const waiverId = payload.waiverId;

      const firstLookupAt = nowMs();
      const waiver = await Waiver.findById(waiverId).lean();
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
        { _id: waiverId, status: { $in: ["pending", "approved"] }, qrConsumedAt: null },
        { $set: { qrConsumedAt: new Date() } },
        { new: true }
      ).lean();
      perfLog("db_query", {
        operation: "reports_validate_consume_qr",
        durationMs: nowMs() - consumeAt
      });

      if (!consumed) {
        const secondLookupAt = nowMs();
        const again = await Waiver.findById(waiverId).lean();
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
      return res.status(400).json({ valid: false, error: "Token inválido." });
    }
  });

  router.get("/waivers", async (req, res) => {
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
    const pending = waivers.filter((w) => w.status === "pending").length;
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
        status: w.status,
        createdAt: w.createdAt
      }))
    });
  });

  return router;
}
