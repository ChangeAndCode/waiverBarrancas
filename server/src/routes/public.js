import { Router } from "express";
import { Attraction } from "../models/Attraction.js";
import { Waiver } from "../models/Waiver.js";
import { signWaiverToken, verifyWaiverToken } from "../lib/token.js";
import { renderWaiverTextForSignature } from "../lib/waiverText.js";
import { sendWaiverQrEmail } from "../lib/email.js";
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
    const items = await Attraction.find({ active: true }).sort({ createdAt: -1 }).lean();
    const previewDate = new Date();
    res.json(
      items.map((item) => ({
        ...item,
        waiverText: renderWaiverTextForSignature(item.waiverText, previewDate)
      }))
    );
  });

  router.post("/create-checkout-session", async (req, res) => {
  try {
const { amount = 1000, successPath = "/success", cancelPath = "/cancel" } = req.body;

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
      success_url: `${process.env.CLIENT_URL}${successPath}`,
      cancel_url: `${process.env.CLIENT_URL}${cancelPath}`
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
      guardian
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
      participant.phone &&
      participant.email &&
      participant.emergencyContactName &&
      participant.emergencyContactPhone;
    if (!requiredParticipant) {
      return res.status(400).json({ error: "Todos los campos del participante son obligatorios." });
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

    const attraction = await Attraction.findOne({ _id: attractionId, active: true }).lean();
    if (!attraction) return res.status(404).json({ error: "Atracción no encontrada." });

    const signedAt = new Date();
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
      waiverTextSnapshot: renderWaiverTextForSignature(attraction.waiverText, signedAt)
    });

    const token = signWaiverToken(waiver._id.toString(), jwtSecret);
    const qrUrl = `${baseUrlFromRequest(req)}/check/${token}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(qrUrl)}`;
    const logoUrl = `${baseUrlFromRequest(req)}/branding/logobarrancas.png`;
    let emailSent = false;

    try {
      const result = await sendWaiverQrEmail({
        to: participant.email,
        participantName: participant.fullName,
        attractionName: attraction.name,
        waiverId: waiver._id.toString(),
        signedAt,
        qrUrl,
        qrImageUrl,
        logoUrl
      });
      emailSent = Boolean(result?.sent);
    } catch (error) {
      console.error("No se pudo enviar correo con Resend:", error.message);
    }

    res.status(201).json({
      waiverId: waiver._id,
      token,
      qrUrl,
      emailSent,
      signedAt: waiver.createdAt
    });
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
