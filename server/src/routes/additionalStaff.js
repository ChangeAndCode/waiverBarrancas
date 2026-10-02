import { Router } from 'express';
import mongoose from 'mongoose';
import { requirePermissions } from '../lib/auth.js';
import { Waiver } from '../models/Waiver.js';
import { WaiverAuditEvent } from '../models/WaiverAuditEvent.js';
import { verifyWaiverToken } from '../lib/token.js';
import { eligibleForAdditional, additionalAuthorized } from '../lib/additionalActivities.js';
import { getWaiverQrExpiresAt, qrWriteGuard } from '../lib/waiverValidity.js';
import { parkDateTime } from '../../../shared/visitSchedule.js';
import { waiverDisplayId } from '../lib/folio.js';

export function additionalStaffRoutes({ jwtSecret }) {
  const router = Router();
  async function context(req, res) {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.activityId)) {
      res.status(400).json({ error: 'Carta o actividad inválida.' }); return null;
    }
    try {
      if (String(verifyWaiverToken(req.body?.qrToken, jwtSecret).waiverId) !== req.params.id) throw new Error();
    } catch { res.status(403).json({ error: 'QR inválido o de otra carta.' }); return null; }
    const waiver = await Waiver.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!eligibleForAdditional(waiver)) { res.status(409).json({ error: 'Carta no disponible o vencida.' }); return null; }
    const activity = waiver.additionalActivities?.find(a => String(a._id) === req.params.activityId);
    if (!activity) { res.status(404).json({ error: 'Actividad no encontrada.' }); return null; }
    return { waiver, activity };
  }
  router.post('/waivers/:id/activities/:activityId/review', requirePermissions('waiver.review', 'waiver.schedule.assign', 'waiver.comment'), async (req, res, next) => {
    try {
      const ctx = await context(req, res); if (!ctx) return;
      const { waiver, activity } = ctx;
      const { decision, date, time, group } = req.body;
      const comment = String(req.body.comment || '').trim();
      if (!['approved', 'rejected'].includes(decision) || comment.length > 1000 || (decision === 'rejected' && !comment)) return res.status(400).json({ error: 'Decisión o comentario inválido.' });
      if (activity.status !== 'pending') return res.status(409).json({ error: 'La actividad ya fue revisada.' });
      const now = new Date();
      const instant = parkDateTime(date, time);
      const expiresAt = getWaiverQrExpiresAt(waiver);
      if (decision === 'approved' && (waiver.status !== 'approved' || !instant || instant < now || instant < parkDateTime(waiver.visitDate) || !expiresAt || instant >= expiresAt || !String(group || '').trim() || String(group).length > 100)) return res.status(400).json({ error: 'Valida primero la carta y elige un horario futuro dentro de su vigencia y un grupo.' });
      const changes = {
        'additionalActivities.$.status': decision,
        'additionalActivities.$.review': { decision, comment, reviewedAt: now, reviewedBy: req.user._id }
      };
      if (decision === 'approved') Object.assign(changes, {
        'additionalActivities.$.validatedAt': now, 'additionalActivities.$.validatedBy': req.user._id,
        'additionalActivities.$.schedule': { date, time, group: String(group).trim(), assignedAt: now, assignedBy: req.user._id }
      });
      const updated = await Waiver.findOneAndUpdate({ _id: waiver._id, deletedAt: null, status: waiver.status, assignedAt: waiver.assignedAt, ...qrWriteGuard(waiver),
        additionalActivities: { $elemMatch: { _id: activity._id, status: 'pending' } } }, { $set: changes }, { new: true }).lean();
      if (!updated) return res.status(409).json({ error: 'La carta cambió. Consulta nuevamente.' });
      await WaiverAuditEvent.create({ waiverId: waiver._id, userId: req.user._id, userRole: req.user.role, action: 'activity_reviewed', comment, metadata: { activityId: req.params.activityId, decision, date, time } });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  router.post('/waivers/:id/activities/:activityId/ticket', requirePermissions('waiver.ticket.print'), async (req, res, next) => {
    try {
      const ctx = await context(req, res); if (!ctx) return;
      const { waiver, activity } = ctx;
      if (!additionalAuthorized(waiver, activity)) return res.status(409).json({ error: 'Actividad no autorizada.' });
      await WaiverAuditEvent.create({ waiverId: waiver._id, userId: req.user._id, userRole: req.user.role, action: 'ticket_printed', metadata: { activityId: req.params.activityId } });
      res.json({ ok: true, ticket: { id: waiverDisplayId(waiver), activityId: req.params.activityId, fullName: waiver.participant.fullName, attractionName: activity.attractionName,
        ...activity.schedule, cityState: waiver.participant.cityState || '', qrToken: waiver.qrToken || req.body.qrToken,
        qrUrl: waiver.qrUrl || `${process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`}/check/${req.body.qrToken}` } });
    } catch (error) { next(error); }
  });
  return router;
}
