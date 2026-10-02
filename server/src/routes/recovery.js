import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Waiver } from '../models/Waiver.js';
import { Attraction } from '../models/Attraction.js';
import { WaiverRecovery } from '../models/WaiverRecovery.js';
import { WaiverAuditEvent } from '../models/WaiverAuditEvent.js';
import { canSendEmails, sendRecoveryEmail } from '../lib/email.js';
import { verifyWaiverToken } from '../lib/token.js';
import { eligibleForAdditional, activitySummaries } from '../lib/additionalActivities.js';
import { getWaiverQrExpiresAt } from '../lib/waiverValidity.js';
import { waiverDisplayId } from '../lib/folio.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const normalize = value => String(value || '').trim().toLowerCase();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function recoveryRoutes({ jwtSecret }) {
  const router = Router();
  // Bounded per-process abuse protection; shared storage is required for multi-instance deployments.
  const buckets = new Map();
  router.use((req, res, next) => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
    const keys = [`ip:${digest(req.ip)}`];
    if (req.body?.email) keys.push(`email:${digest(normalize(req.body.email))}`);
    for (const key of keys) {
      const bucket = buckets.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
      bucket.count++;
      buckets.set(key, bucket);
      if (bucket.count > (key.startsWith("email:") ? 5 : 150) || buckets.size > 10000) return res.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
    }
    next();
  });
  router.post('/request', async (req, res, next) => {
    try {
      const email = normalize(req.body?.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Correo inválido.' });
      const code = randomBytes(24).toString('hex');
      await WaiverRecovery.create({ email, codeHash: digest(code), expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
      // Same response and delivery path whether or not a waiver exists.
      if (canSendEmails()) {
        try { await sendRecoveryEmail({ to: email, code }); }
        catch { console.error('No se pudo enviar el correo de recuperación.'); }
      }
      res.json({ ok: true, message: 'Revisa tu correo para continuar.' });
    } catch (error) { next(error); }
  });
  router.post('/verify', async (req, res, next) => {
    try {
      const code = String(req.body?.code || '').trim();
      if (!/^[a-f0-9]{48}$/.test(code)) return res.status(400).json({ error: 'Código inválido o expirado.' });
      const recovery = await WaiverRecovery.findOneAndUpdate({ codeHash: digest(code), usedAt: null, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { new: true }).lean();
      if (!recovery) return res.status(400).json({ error: 'Código inválido o expirado.' });
      const session = jwt.sign({ purpose: 'waiver-recovery', email: recovery.email }, jwtSecret, { expiresIn: '15m' });
      res.json({ session });
    } catch (error) { next(error); }
  });
  router.use((req, res, next) => {
    try {
      const claims = jwt.verify(String(req.headers.authorization || '').replace(/^Bearer /, ''), jwtSecret);
      if (claims.purpose !== 'waiver-recovery' || !claims.email) throw new Error();
      req.recoveryEmail = claims.email;
      next();
    } catch { res.status(401).json({ error: 'Verifica nuevamente tu correo.' }); }
  });
  const emailFilter = email => ({ 'participant.email': { $regex: `^\\s*${escape(email)}\\s*$`, $options: 'i' }, deletedAt: null });
  router.get('/waivers', async (req, res, next) => {
    try {
      const waivers = await Waiver.find(emailFilter(req.recoveryEmail)).sort({ createdAt: -1 }).lean();
      res.json(waivers.filter(w => eligibleForAdditional(w)).map(w => ({
        id: String(w._id), folio: waiverDisplayId(w), fullName: w.participant.fullName, visitDate: w.visitDate,
        attractionName: w.attractionName, expiresAt: getWaiverQrExpiresAt(w), qrUrl: w.qrUrl || '',
        attractionIds: [String(w.attractionId), ...(w.attractionIds || []).map(String), ...(w.additionalActivities || []).map(a => String(a.attractionId))],
        additionalActivities: activitySummaries(w)
      })));
    } catch (error) { next(error); }
  });
  router.post('/waivers/:id/activities', async (req, res, next) => {
    try {
      const { attractionId, qrToken, originalQrUrl } = req.body || {};
      if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(attractionId)) return res.status(400).json({ error: 'Actividad o carta inválida.' });
      const waiver = await Waiver.findOne({ _id: req.params.id, ...emailFilter(req.recoveryEmail) }).lean();
      if (!eligibleForAdditional(waiver)) return res.status(409).json({ error: 'Carta no disponible o vencida.' });
      let originalToken = waiver.qrToken;
      let qrUrl = waiver.qrUrl;
      if (!originalToken) {
        try {
          if (String(verifyWaiverToken(qrToken, jwtSecret).waiverId) !== String(waiver._id)) throw new Error();
          originalToken = qrToken;
          const base = String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
          const supplied = new URL(originalQrUrl);
          if (!['https:', 'http:'].includes(supplied.protocol) || supplied.username || supplied.password ||
              supplied.origin !== new URL(base).origin || supplied.pathname !== `/check/${qrToken}` || supplied.search || supplied.hash) throw new Error();
          qrUrl = supplied.href;
        } catch { return res.status(409).json({ error: 'Esta carta histórica requiere su enlace QR original.' }); }
      }
      const attraction = await Attraction.findOne({ _id: attractionId, active: true }).lean();
      if (!attraction) return res.status(400).json({ error: 'Actividad no disponible.' });
      const activity = { _id: new mongoose.Types.ObjectId(), attractionId: attraction._id, attractionName: attraction.name, status: 'pending', requestedAt: new Date() };
      const updated = await Waiver.findOneAndUpdate({
        _id: waiver._id, ...emailFilter(req.recoveryEmail), status: waiver.status, assignedAt: waiver.assignedAt,
        attractionId: { $ne: attractionId }, attractionIds: { $ne: attractionId }, 'additionalActivities.attractionId': { $ne: attractionId },
        qrToken: waiver.qrToken || null
      }, { $push: { additionalActivities: activity }, $set: { qrToken: originalToken, qrUrl } }, { new: true }).lean();
      if (!updated) return res.status(409).json({ error: 'Actividad duplicada o carta modificada. Consulta nuevamente.' });
      await WaiverAuditEvent.create({ waiverId: waiver._id, action: 'activity_requested', metadata: { activityId: String(activity._id), attractionId } });
      res.status(201).json({ ok: true, activityId: String(activity._id), qrUrl, status: 'pending' });
    } catch (error) { next(error); }
  });
  return router;
}
