import { randomBytes } from "node:crypto";
import { Router } from "express";
import { Attraction } from "../models/Attraction.js";
import { Waiver } from "../models/Waiver.js";
import { WaiverDraft } from "../models/WaiverDraft.js";
import { signWaiverToken, verifyWaiverToken } from "../lib/token.js";
import { renderWaiverTextForSignature } from "../lib/waiverText.js";
import { canSendEmails, sendWaiverQrEmail } from "../lib/email.js";
import { nowMs, perfLog } from "../lib/perf.js";
import Stripe from "stripe";

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Falta STRIPE_SECRET_KEY en las variables de entorno.");
  }

  return new Stripe(secretKey);
}

function baseUrlFromRequest(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function calculateAge(birthDateString) {
  const birthDate = new Date(birthDateString);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

export function publicRoutes({ jwtSecret }) {
  const router = Router();

  router.get("/attractions", async (_req, res) => {
    const startedAt = nowMs();
    const items = await Attraction.find({ active: true }).sort({ createdAt: -1 }).lean();
    perfLog("db_query", {
      operation: "attraction_list_active",
      durationMs: nowMs() - startedAt
    });
    const previewDate = new Date();
    res.json(
      items.map((item) => ({
        ...item,
        waiverText: renderWaiverTextForSignature(item.waiverText, previewDate)
      }))
    );
  });

  router.post("/waiver-drafts", async (req, res) => {
    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Payload requerido." });
    }
    try {
      const key = randomBytes(24).toString("hex");
      await WaiverDraft.create({ key, payload });
      res.status(201).json({ draftKey: key });
    } catch (e) {
      console.error("waiver-draft save:", e);
      res.status(500).json({ error: "No se pudo guardar el borrador." });
    }
  });

  router.post("/waiver-drafts/read", async (req, res) => {
    const key = String(req.body?.draftKey || "").trim();
    if (!/^[a-f0-9]{48}$/.test(key)) {
      return res.status(400).json({ error: "Borrador inválido." });
    }
    const doc = await WaiverDraft.findOne({ key }).lean();
    if (!doc) {
      return res.status(404).json({ error: "Borrador no encontrado o expirado." });
    }
    res.json(doc.payload);
  });

  router.post("/waiver-drafts/release", async (req, res) => {
    const key = String(req.body?.draftKey || "").trim();
    if (!/^[a-f0-9]{48}$/.test(key)) {
      return res.status(400).json({ error: "Borrador inválido." });
    }
    await WaiverDraft.deleteOne({ key });
    res.json({ ok: true });
  });

  router.post("/create-checkout-session", async (req, res) => {
    try {
      const {
        amount = 3000,
        successPath = "/success",
        cancelPath = "/cancel",
        draftKey
      } = req.body ?? {};

      const base = String(process.env.CLIENT_URL || "").replace(/\/$/, "");
      if (!base) {
        return res.status(500).json({ error: "Falta CLIENT_URL." });
      }

      let successUrl = `${base}${successPath}`;
      if (draftKey) {
        const dk = encodeURIComponent(String(draftKey).trim());
        if (dk.length < 48) {
          return res.status(400).json({ error: "draftKey inválido." });
        }
        const join = successPath.includes("?") ? "&" : "?";
        successUrl = `${base}${successPath}${join}draft=${dk}`;
      }

      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "mxn",
              product_data: {
                name: "Acceso a atracción"
              },
              unit_amount: amount
            },
            quantity: 1
          }
        ],
        success_url: successUrl,
        cancel_url: `${base}${cancelPath}`
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Stripe error:", error);
      res.status(500).json({ error: error.message || "Error creando sesión de pago" });
    }
  });

  router.post("/waivers", async (req, res) => {
    const {
      attractionId,
      participant,
      answers,
      acceptedText,
      signatureName,
      signatureImage,
      guardian,
      witness
    } = req.body ?? {};

    if (!attractionId || !participant || !answers || acceptedText !== true || !signatureName || !signatureImage) {
      return res.status(400).json({ error: "Datos incompletos." });
    }
    if (!String(signatureImage).startsWith("data:image/png;base64,")) {
      return res.status(400).json({ error: "Firma manuscrita inválida." });
    }
    const requiredParticipant =
      participant.fullName &&
      participant.birthDate &&
      participant.gender && 
      participant.phone &&
      participant.email &&
      participant.emergencyContactName &&
      participant.emergencyContactPhone;
    if (!requiredParticipant) {
      return res.status(400).json({ error: "Todos los campos del participante son obligatorios." });
    }
    const extendedParticipant =
      participant.nationality &&
      participant.cityState &&
      participant.medications &&
      participant.treatingPhysician &&
      participant.physicianPhone &&
      participant.emergencyContactRelationship &&
      participant.familyReference2Name &&
      participant.familyReference2Relationship &&
      participant.familyReference2Phone;
    if (!extendedParticipant) {
      return res.status(400).json({ error: "Faltan campos adicionales del participante." });
    }
    const witnessValid =
      witness?.signatureImage &&
      String(witness.signatureImage).startsWith("data:image/png;base64,");
    if (!witnessValid) {
      return res.status(400).json({ error: "La firma del testigo es obligatoria." });
    }
    if (answers.acceptsSafetyRules !== true) {
      return res.status(400).json({ error: "Debes aceptar reglas de seguridad." });
    }

    const age = calculateAge(participant.birthDate);
    if (age === null || age < 0) return res.status(400).json({ error: "Fecha de nacimiento inválida." });
    const isMinor = age < 18;

    if (isMinor) {
      const guardianValid =
        guardian &&
        guardian.fullName &&
        guardian.relation &&
        guardian.phone &&
        guardian.email &&
        guardian.signatureImage &&
        String(guardian.signatureImage).startsWith("data:image/png;base64,");
      if (!guardianValid) {
        return res.status(400).json({ error: "Para menores de edad, los datos y firma del tutor son obligatorios." });
      }
    }

    const attractionQueryAt = nowMs();
    const attraction = await Attraction.findOne({ _id: attractionId, active: true }).lean();
    perfLog("db_query", {
      operation: "attraction_find_one_active",
      durationMs: nowMs() - attractionQueryAt
    });
    if (!attraction) return res.status(404).json({ error: "Atracción no encontrada." });

    const signedAt = new Date();
    const createWaiverAt = nowMs();
    const waiver = await Waiver.create({
      attractionId: attraction._id,
      attractionName: attraction.name,
      participant,
      isMinor,
      guardian: isMinor ? guardian : undefined,
      answers,
      acceptedText,
      signatureName,
      signatureImage,
      witness,
      waiverTextSnapshot: renderWaiverTextForSignature(attraction.waiverText, signedAt)
    });
    perfLog("db_query", {
      operation: "waiver_create",
      durationMs: nowMs() - createWaiverAt
    });

    const token = signWaiverToken(waiver._id.toString(), jwtSecret);
    const qrUrl = `${baseUrlFromRequest(req)}/check/${token}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(qrUrl)}`;
    const logoUrl = `${baseUrlFromRequest(req)}/branding/logobarrancas.png`;
    const emailSent = canSendEmails();

    res.status(201).json({
      waiverId: waiver._id,
      token,
      qrUrl,
      emailSent,
      signedAt: waiver.createdAt
    });

    // Enviar correo fuera del ciclo de respuesta para reducir latencia en picos.
    if (emailSent) {
      setImmediate(async () => {
        const emailAt = nowMs();
        try {
          await sendWaiverQrEmail({
            to: participant.email,
            participantName: participant.fullName,
            attractionName: attraction.name,
            waiverId: waiver._id.toString(),
            signedAt,
            qrUrl,
            qrImageUrl,
            logoUrl
          });
          perfLog("async_email", {
            provider: "resend",
            ok: true,
            durationMs: nowMs() - emailAt
          });
        } catch (error) {
          perfLog("async_email", {
            provider: "resend",
            ok: false,
            durationMs: nowMs() - emailAt
          });
          console.error("No se pudo enviar correo con Resend:", error.message);
        }
      });
    }
  });

  router.get("/check/:token", async (req, res) => {
    const { token } = req.params;
    try {
      const payload = verifyWaiverToken(token, jwtSecret);
      const waiver = await Waiver.findById(payload.waiverId).lean();

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
      return res.status(400).json({ valid: false, error: "Token inválido." });
    }
  });

  return router;
}
