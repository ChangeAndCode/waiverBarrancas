import { Router } from "express";
import { Attraction } from "../models/Attraction.js";
import { Waiver } from "../models/Waiver.js";
import { signWaiverToken, verifyWaiverToken } from "../lib/token.js";
import { renderWaiverTextForSignature } from "../lib/waiverText.js";

function baseUrlFromRequest(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

export function publicRoutes({ jwtSecret }) {
  const router = Router();

  router.get("/attractions", async (_req, res) => {
    const items = await Attraction.find({ active: true }).sort({ createdAt: -1 }).lean();
    const previewDate = new Date();
    res.json(
      items.map((item) => ({
        ...item,
        waiverText: renderWaiverTextForSignature(item.waiverText, previewDate)
      }))
    );
  });

  router.post("/waivers", async (req, res) => {
    const { attractionId, participant, answers, acceptedText, signatureName, signatureImage } = req.body ?? {};

    if (!attractionId || !participant || !answers || acceptedText !== true || !signatureName || !signatureImage) {
      return res.status(400).json({ error: "Datos incompletos." });
    }
    if (!String(signatureImage).startsWith("data:image/png;base64,")) {
      return res.status(400).json({ error: "Firma manuscrita invalida." });
    }

    const attraction = await Attraction.findOne({ _id: attractionId, active: true }).lean();
    if (!attraction) return res.status(404).json({ error: "Atraccion no encontrada." });

    const signedAt = new Date();
    const waiver = await Waiver.create({
      attractionId: attraction._id,
      attractionName: attraction.name,
      participant,
      answers,
      acceptedText,
      signatureName,
      signatureImage,
      waiverTextSnapshot: renderWaiverTextForSignature(attraction.waiverText, signedAt)
    });

    const token = signWaiverToken(waiver._id.toString(), jwtSecret);
    const qrUrl = `${baseUrlFromRequest(req)}/check/${token}`;

    res.status(201).json({
      waiverId: waiver._id,
      token,
      qrUrl,
      signedAt: waiver.createdAt
    });
  });

  router.get("/check/:token", async (req, res) => {
    const { token } = req.params;
    try {
      const payload = verifyWaiverToken(token, jwtSecret);
      const waiver = await Waiver.findById(payload.waiverId).lean();

      if (!waiver || waiver.status !== "signed") {
        return res.status(404).json({ valid: false, error: "Waiver invalido o revocado." });
      }

      return res.json({
        valid: true,
        waiver: {
          id: waiver._id,
          attractionName: waiver.attractionName,
          fullName: waiver.participant.fullName,
          birthDate: waiver.participant.birthDate,
          signedAt: waiver.createdAt,
          status: waiver.status
        }
      });
    } catch (_error) {
      return res.status(400).json({ valid: false, error: "Token invalido." });
    }
  });

  return router;
}
