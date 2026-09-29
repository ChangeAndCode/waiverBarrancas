import { Router } from "express";
import { requireAuth, requireRoles } from "../lib/auth.js";
import { Waiver } from "../models/Waiver.js";
import { verifyWaiverToken } from "../lib/token.js";
import { nowMs, perfLog } from "../lib/perf.js";
import { waiverDisplayId } from "../lib/folio.js";
import { getWaiverQrExpiresAt, isWaiverQrExpired } from "../lib/waiverValidity.js";

import { parkDateTime } from "../../../shared/visitSchedule.js";
import { visitQrResult } from "../lib/visitQr.js";

export function reportRoutes({ jwtSecret }) {
  const router = Router();
  router.use(requireAuth(jwtSecret), requireRoles("admin", "staff"));

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
      if (!waiver || waiver.status === "revoked") {
        return res.status(404).json({ valid: false, error: "Waiver inválido o revocado." });
      }

      if (waiver.visitDate) {
        const result = visitQrResult(waiver);
        if (result.valid) {
          result.review = {
            participant: waiver.participant, isMinor: waiver.isMinor, guardian: waiver.guardian,
            answers: waiver.answers, signatureImage: waiver.signatureImage,
            witness: waiver.witness, waiverTextSnapshot: waiver.waiverTextSnapshot
          };
        }
        return res.json(result);
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
        { _id: waiverId, status: "signed", qrConsumedAt: null },
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
        if (!again || again.status !== "signed") {
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

      return res.json({
        valid: true,
        waiver: {
          id: waiverDisplayId(consumed),
          attractionName: consumed.attractionName,
          fullName: consumed.participant.fullName,
          birthDate: consumed.participant.birthDate,
          signedAt: consumed.createdAt,
          status: consumed.status
        }
      });
    } catch (_error) {
      return res.status(400).json({ valid: false, error: "Token inválido." });
    }
  });

  // Explicit Staff action: reading/scanning a new QR never approves or consumes it.
  router.post("/validate/:token", async (req, res) => {
    let payload;
    try {
      payload = verifyWaiverToken(req.params.token, jwtSecret);
    } catch {
      return res.status(400).json({ error: "Token inválido." });
    }
    try {
      const waiver = await Waiver.findById(payload.waiverId).lean();
      if (!waiver || waiver.status === "revoked") {
        return res.status(404).json({ error: "Waiver inválido o revocado." });
      }
      if (!waiver.visitDate || waiver.status !== "pending_validation") {
        return res.status(409).json({ error: "La carta ya fue validada o no pertenece al flujo de visitas." });
      }
      const assignedAt = parkDateTime(waiver.visitDate, req.body?.assignedTime);
      if (!req.body?.assignedTime || !assignedAt || assignedAt.getTime() < Date.now()) {
        return res.status(400).json({ error: "Indica una hora válida, no pasada, del día de visita (hora del parque)." });
      }
      const updated = await Waiver.findOneAndUpdate(
        { _id: waiver._id, status: "pending_validation", visitDate: waiver.visitDate },
        { $set: { assignedAt, status: "validated", validatedAt: new Date(), validatedBy: req.auth.sub } },
        { new: true }
      ).lean();
      if (!updated) return res.status(409).json({ error: "La carta cambió. Consulta nuevamente el QR." });
      return res.json(visitQrResult(updated));
    } catch (error) {
      console.error("Validación de visita:", error.message);
      return res.status(500).json({ error: "No se pudo validar la visita." });
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
    const signed = waivers.filter((w) => w.status === "signed").length;
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
      summary: { total, signed, revoked, pending_validation: waivers.filter((w) => w.status === "pending_validation").length, validated: waivers.filter((w) => w.status === "validated").length },
      byAttraction,
      waivers: waivers.map((w) => ({
        id: waiverDisplayId(w),
        attractionName: w.attractionName,
        fullName: w.participant.fullName,
        email: w.participant.email,
        status: w.status,
        visitDate: w.visitDate,
        assignedAt: w.assignedAt,
        createdAt: w.createdAt
      }))
    });
  });

  return router;
}
