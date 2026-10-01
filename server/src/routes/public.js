import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { Attraction } from "../models/Attraction.js";
import { PARK_ATTRACTIONS, sortParkAttractions } from "../lib/parkAttractions.js";
import { Waiver } from "../models/Waiver.js";
import { WaiverDraft } from "../models/WaiverDraft.js";
import { WaiverAuditEvent } from "../models/WaiverAuditEvent.js";
import { signWaiverToken, verifyWaiverToken } from "../lib/token.js";
import { renderWaiverTextForSignature } from "../lib/waiverText.js";
import { WAIVER_TEXT_EN_HTML } from "../lib/waiverTextEn.js";
import { generateWaiverFolio, waiverDisplayId } from "../lib/folio.js";
import { getWaiverQrExpiresAt, isWaiverQrExpired } from "../lib/waiverValidity.js";
import { canSendEmails, sendWaiverQrEmail } from "../lib/email.js";
import { nowMs, perfLog } from "../lib/perf.js";
import Stripe from "stripe";
import { canRegisterVisit } from "../../../shared/visitSchedule.js";
import { visitQrResult } from "../lib/visitQr.js";

function meaningfulText(value, minLength = 2) {
  return String(value || "").trim().length >= minLength;
}

function indicatesNoMedications(medications) {
  const text = String(medications || "").trim().toLowerCase();
  return !text || text === "no" || text === "ninguno" || text === "ninguna";
}

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
    const parkCodes = PARK_ATTRACTIONS.map((item) => item.code);
    const items = sortParkAttractions(
      await Attraction.find({ active: true, code: { $in: parkCodes } }).lean()
    );
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
        const draft = await WaiverDraft.findOne({ key: String(draftKey).trim() }).lean();
        if (!draft?.payload?.attractionId) {
          return res.status(400).json({ error: "Borrador inválido." });
        }
        const attraction = await Attraction.findOne({
          _id: draft.payload.attractionId,
          active: true
        }).lean();
        if (!attraction) {
          return res.status(404).json({ error: "Atracción no encontrada." });
        }
        if (!attraction.stripeEnabled) {
          return res.status(400).json({ error: "Esta atracción no requiere pago en línea." });
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
      attractionIds,
      participant,
      answers,
      acceptedText,
      signatureName,
      signatureImage,
      guardian,
      witness,
      locale,
      visitDate
    } = req.body ?? {};

    if ((!attractionId && (!Array.isArray(attractionIds) || !attractionIds.length)) || !participant || !answers || acceptedText !== true || !signatureName || !signatureImage) {
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
      meaningfulText(participant.nationality) &&
      meaningfulText(participant.cityState, 3) &&
      meaningfulText(participant.medications, 1) &&
      (indicatesNoMedications(participant.medications) ||
        (meaningfulText(participant.treatingPhysician) &&
          meaningfulText(participant.physicianPhone, 7))) &&
      meaningfulText(participant.emergencyContactRelationship) &&
      meaningfulText(participant.emergencyContactName) &&
      meaningfulText(participant.emergencyContactPhone, 7);
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

    if (!canRegisterVisit(visitDate)) {
      return res.status(400).json({ error: "Elige un día de visita con al menos 24 horas de anticipación al inicio de ese día (hora del parque)." });
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

    const requestedAttractionIds = (
      Array.isArray(attractionIds) && attractionIds.length ? attractionIds : [attractionId]
    )
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    if (!requestedAttractionIds.length) {
      return res.status(400).json({ error: "Selecciona al menos una atracción." });
    }

    const attractionsQueryAt = nowMs();
    const attractionsList = await Attraction.find({
      _id: { $in: requestedAttractionIds },
      active: true
    }).lean();
    perfLog("db_query", {
      operation: "attractions_find_active_by_ids",
      durationMs: nowMs() - attractionsQueryAt
    });
    if (attractionsList.length !== requestedAttractionIds.length) {
      return res.status(404).json({ error: "Atracción no encontrada." });
    }
    const attractionsById = new Map(attractionsList.map((a) => [String(a._id), a]));
    const orderedAttractions = requestedAttractionIds.map((id) => attractionsById.get(id));
    const attraction = orderedAttractions[0];
    const attractionName = orderedAttractions.map((a) => a.name).join(", ");

    const signedAt = new Date();
    const waiverTextSource =
      String(locale || "").trim().toLowerCase() === "en"
        ? WAIVER_TEXT_EN_HTML
        : attraction.waiverText;
    const folio = await generateWaiverFolio();
    const createWaiverAt = nowMs();
    const waiverId = new mongoose.Types.ObjectId();
    const token = signWaiverToken(String(waiverId), jwtSecret);
    const qrUrl = `${baseUrlFromRequest(req)}/check/${token}`;
    const waiver = await Waiver.create({
      _id: waiverId,
      qrToken: token,
      qrUrl,
      folio,
      visitDate,
      status: "pending",
      attractionId: attraction._id,
      attractionName,
      attractionIds: orderedAttractions.map((a) => a._id),
      attractionNames: orderedAttractions.map((a) => a.name),
      participant,
      isMinor,
      guardian: isMinor ? guardian : undefined,
      answers,
      acceptedText,
      signatureName,
      signatureImage,
      witness,
      waiverTextSnapshot: renderWaiverTextForSignature(waiverTextSource, signedAt),
      status: "pending"
    });
    perfLog("db_query", {
      operation: "waiver_create",
      durationMs: nowMs() - createWaiverAt
    });
    await WaiverAuditEvent.create({
      waiverId: waiver._id,
      action: "waiver_created",
      userRole: null,
      metadata: { source: "public_form" }
    });

const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(qrUrl)}`;

await WaiverAuditEvent.create({
  waiverId: waiver._id,
  action: "qr_generated",
  userRole: null,
  metadata: { source: "jwt_qr" }
});
    const logoUrl = `${baseUrlFromRequest(req)}/branding/logobarrancas.png`;
    let emailSent = false;
    if (canSendEmails()) {
      try {
        const result = await sendWaiverQrEmail({
          to: participant.email, participantName: participant.fullName,
          attractionName: waiver.attractionName, attractionNames: waiver.attractionNames,
          waiverId: waiver.folio, signedAt, qrUrl, logoUrl, locale, visitDate
        });
        emailSent = result.sent;
      } catch (error) {
        console.error("No se pudo enviar correo con Resend:", error.message);
      }
    }
    // The waiver is already saved: an email failure must not encourage a duplicate registration.
    res.status(201).json({
      folio: waiver.folio, waiverId: waiver.folio, token, qrUrl, emailSent,
      signedAt: waiver.createdAt, status: waiver.status, visitDate: waiver.visitDate,
      assignedAt: null, expiresAt: null
    });
  });

  router.get("/check/:token", async (req, res) => {
    const { token } = req.params;
    try {
      const payload = verifyWaiverToken(token, jwtSecret);
      const waiver = await Waiver.findOne({ _id: payload.waiverId, deletedAt: null }).lean();

    // No existe o fue revocado.
    if (!waiver || waiver.status === "revoked") {
      return res.status(404).json({
        valid: false,
        error: "Waiver inválido o revocado."
      });
    }

    // Flujo nuevo de visitas programadas.
    // visitQrResult determina autorización, horario y expiración.
    if (waiver.visitDate) {
      return res.json(visitQrResult(waiver));
    }

    // Flujo legacy: QR con vigencia original.
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

    // Waiver rechazado por Staff.
    if (waiver.status === "rejected") {
      return res.json({
        valid: false,
        reason: "waiver_rejected",
        status: "rejected",
        comment: waiver.review?.comment || "",
        attractionName: waiver.attractionName,
        fullName: waiver.participant.fullName,
        signedAt: waiver.createdAt
      });
    }

    // Pendiente de revisión/validación.
    // "signed" se conserva únicamente por compatibilidad con registros anteriores.
    if (["pending", "signed"].includes(waiver.status)) {
      return res.json({
        valid: false,
        reason: "waiver_pending",
        status: "pending",
        attractionName: waiver.attractionName,
        fullName: waiver.participant.fullName,
        signedAt: waiver.createdAt
      });
    }

    // Compatibilidad con QRs legacy de un solo uso.
    if (waiver.qrConsumedAt) {
      return res.json({
        valid: false,
        reason: "qr_already_used",
        usedAt: waiver.qrConsumedAt,
        attractionName: waiver.attractionName,
        fullName: waiver.participant.fullName
      });
    }

    // Waiver válido/aprobado.
    return res.json({
      valid: true,
      status: waiver.status,
      waiver: {
        id: waiverDisplayId(waiver),
        attractionName: waiver.attractionName,
        fullName: waiver.participant.fullName,
        birthDate: waiver.participant.birthDate,
        signedAt: waiver.createdAt,
        status: waiver.status,
        review: waiver.review || null
      }
    });
  } catch (_error) {
    return res.status(400).json({
      valid: false,
      error: "Token inválido."
    });
  }
});

return router;
}
