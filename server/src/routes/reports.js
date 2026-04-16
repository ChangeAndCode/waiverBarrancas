import { Router } from "express";
import { requireAuth, requireRoles } from "../lib/auth.js";
import { Waiver } from "../models/Waiver.js";
import { verifyWaiverToken } from "../lib/token.js";

export function reportRoutes({ jwtSecret }) {
  const router = Router();
  router.use(requireAuth(jwtSecret), requireRoles("admin", "staff"));

  router.get("/waivers", async (req, res) => {
    const query = {};
    if (req.query.attractionId) query.attractionId = req.query.attractionId;
    if (req.query.from || req.query.to) {
      query.createdAt = {};
      if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
    }

    const waivers = await Waiver.find(query).sort({ createdAt: -1 }).limit(300).lean();
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
      summary: { total, signed, revoked },
      byAttraction,
      waivers: waivers.map((w) => ({
        id: w._id,
        attractionName: w.attractionName,
        fullName: w.participant.fullName,
        email: w.participant.email,
        status: w.status,
        createdAt: w.createdAt
      }))
    });
  });

  router.get("/validate/:token", async (req, res) => {
    try {
      const payload = verifyWaiverToken(req.params.token, jwtSecret);
      const waiverId = payload.waiverId;

      const waiver = await Waiver.findById(waiverId).lean();
      if (!waiver || waiver.status !== "signed") {
        return res.status(404).json({ valid: false, error: "Waiver inválido o revocado." });
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

      const consumed = await Waiver.findOneAndUpdate(
        { _id: waiverId, status: "signed", qrConsumedAt: null },
        { $set: { qrConsumedAt: new Date() } },
        { new: true }
      ).lean();

      if (!consumed) {
        const again = await Waiver.findById(waiverId).lean();
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
          id: consumed._id,
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

  return router;
}
