import test from 'node:test';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { testApp, payload, staffToken, secret, attractions } from './fixture.js';
import { verifyWaiverToken } from '../src/lib/token.js';
import { eligibleForAdditional, additionalAuthorized } from '../src/lib/additionalActivities.js';
import { parkDateTime } from '../../shared/visitSchedule.js';

async function setup(t) {
  const old = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL };
  process.env.RESEND_API_KEY = 'test'; process.env.RESEND_FROM_EMAIL = 'park@example.test';
  t.after(() => {
    for (const [key, value] of [['RESEND_API_KEY', old.key], ['RESEND_FROM_EMAIL', old.from]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const codes = [], realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (!String(url).startsWith('https://api.resend.com/')) return realFetch(url, options);
    const body = JSON.parse(options.body);
    if (!body.attachments) codes.push(body.html.match(/[a-f0-9]{48}/)[0]);
    return Promise.resolve({ ok: true });
  });
  const fixture = testApp(t.mock);
  const server = fixture.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, method = 'GET', body, auth) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json() };
  };
  return { ...fixture, request, codes };
}

test('verified recovery selects among multiple waivers; requests are independent, atomic and preserve signed data and QR', async t => {
  const { request, records, codes } = await setup(t);
  const created = await request('/public/waivers', 'POST', payload());
  const second = await request('/public/waivers', 'POST', payload());
  assert.equal(created.status, 201);
  const id = verifyWaiverToken(created.data.token, secret).waiverId;
  const w = records.get(id);
  const document = structuredClone({ participant: w.participant, answers: w.answers, guardian: w.guardian,
    signatureImage: w.signatureImage, witness: w.witness, waiverTextSnapshot: w.waiverTextSnapshot, createdAt: w.createdAt, visitDate: w.visitDate });
  const initial = await request('/public/recovery/request', 'POST', { email: ' VISITANTE@EXAMPLE.TEST ' });
  const missing = await request('/public/recovery/request', 'POST', { email: 'missing@example.test' });
  assert.deepEqual(initial.data, missing.data);
  assert.equal((await request('/public/recovery/waivers', 'GET', undefined, created.data.token)).status, 401);
  assert.equal((await request('/public/recovery/verify', 'POST', { code: 'wrong' })).status, 400);
  assert.equal((await request('/public/recovery/verify', 'POST', { code: 'f'.repeat(48) })).status, 400);
  const verified = await request('/public/recovery/verify', 'POST', { code: codes[0] });
  assert.equal(verified.status, 200);
  assert.equal((await request('/public/recovery/verify', 'POST', { code: codes[0] })).status, 400);
  const session = verified.data.session;
  const expiredSession = jwt.sign({ purpose: 'waiver-recovery', email: w.participant.email, exp: 1 }, secret);
  assert.equal((await request('/public/recovery/waivers', 'GET', undefined, expiredSession)).status, 401);
  const otherSession = (await request('/public/recovery/verify', 'POST', { code: codes[1] })).data.session;
  assert.equal((await request(`/public/recovery/waivers/${id}/activities`, 'POST', { attractionId: attractions[2]._id }, otherSession)).status, 409);
  assert.equal((await request('/public/recovery/waivers', 'GET', undefined, otherSession)).data.length, 0);
  const listed = await request('/public/recovery/waivers', 'GET', undefined, session);
  assert.equal(listed.data.length, 2);
  assert.equal(listed.data[0].participant, undefined);
  assert.equal(listed.data.find(row => row.id === id).qrUrl, created.data.qrUrl);
  await request(`/reports/validate/${created.data.token}`, 'POST', { assignedTime: '09:00' }, staffToken);
  const originalAssigned = w.assignedAt;
  const savedActive = attractions[2].active;
  attractions[2].active = false;
  assert.equal((await request(`/public/recovery/waivers/${id}/activities`, 'POST', { attractionId: attractions[2]._id }, session)).status, 400);
  attractions[2].active = savedActive;
  const addition = { attractionId: attractions[2]._id, status: 'approved', schedule: { time: '10:00' } };
  assert.equal((await request(`/public/recovery/waivers/${id}/activities`, 'POST', { attractionId: attractions[0]._id }, session)).status, 409);
  const repeated = await Promise.all([1, 2].map(() => request(`/public/recovery/waivers/${id}/activities`, 'POST', addition, session)));
  assert.deepEqual(repeated.map(r => r.status).sort(), [201, 409]);
  const aid = repeated.find(r => r.status === 201).data.activityId;
  const activity = w.additionalActivities[0];
  assert.equal(activity.status, 'pending'); assert.equal(activity.schedule, undefined);
  let scan = await request(`/reports/validate/${created.data.token}`, 'GET', undefined, staffToken);
  assert.equal(scan.data.accessAuthorized, false);
  assert.equal(scan.data.originalAccessAuthorized, true);
  assert.equal(scan.data.additionalActivities[0].accessAuthorized, false);
  const endpoint = `/reports/waivers/${id}/activities/${aid}`;
  assert.equal((await request(`${endpoint}/ticket`, 'POST', { qrToken: created.data.token }, staffToken)).status, 409);
  assert.equal((await request(`${endpoint}/review`, 'POST', { decision: 'approved', qrToken: created.data.token })).status, 401);
  const review = { decision: 'approved', date: w.visitDate, time: '10:00', group: 'Grupo adicional', qrToken: created.data.token };
  assert.equal((await request(`${endpoint}/review`, 'POST', { ...review, date: '2020-01-01' }, staffToken)).status, 400);
  assert.equal((await request(`${endpoint}/review`, 'POST', { ...review, date: '2099-01-01' }, staffToken)).status, 400);
  assert.equal((await request(`${endpoint}/review`, 'POST', { ...review, qrToken: second.data.token }, staffToken)).status, 403);
  const approvals = await Promise.all([1, 2].map(() => request(`${endpoint}/review`, 'POST', review, staffToken)));
  assert.deepEqual(approvals.map(r => r.status).sort(), [200, 409]);
  assert.equal(activity.status, 'approved'); assert.equal(activity.schedule.time, '10:00');
  assert.deepEqual(w.assignedAt, originalAssigned);
  const print = await request(`${endpoint}/ticket`, 'POST', { qrToken: created.data.token }, staffToken);
  assert.equal(print.status, 200); assert.equal(print.data.ticket.attractionName, attractions[2].name);
  assert.equal(print.data.ticket.qrToken, created.data.token); assert.equal(print.data.ticket.qrUrl, created.data.qrUrl);
  assert.equal(print.data.ticket.time, '10:00');
  await request(`/public/recovery/waivers/${id}/activities`, 'POST', { attractionId: attractions[3]._id }, session);
  const rejectedId = w.additionalActivities[1]._id;
  assert.equal((await request(`/reports/waivers/${id}/activities/${rejectedId}/review`, 'POST', { decision: 'rejected', comment: 'No disponible', qrToken: created.data.token }, staffToken)).status, 200);
  assert.equal(w.additionalActivities[1].status, 'rejected'); assert.equal(activity.status, 'approved'); assert.equal(w.status, 'approved');
  assert.equal((await request(`/reports/waivers/${id}/activities/${rejectedId}/ticket`, 'POST', { qrToken: created.data.token }, staffToken)).status, 409);
  for (const [key, value] of Object.entries(document)) assert.deepEqual(w[key], value);
  assert.equal(w.qrToken, created.data.token); assert.equal(w.qrUrl, created.data.qrUrl);
  w.status = 'revoked';
  assert.equal((await request(`${endpoint}/ticket`, 'POST', { qrToken: created.data.token }, staffToken)).status, 409);
  assert.equal((await request(`/public/recovery/waivers/${id}/activities`, 'POST', addition, session)).status, 409);
  assert.equal((await request('/public/recovery/waivers', 'GET', undefined, session)).data.length, 1);
});

test('expired recovery, abuse limits and historical QR association preserve legacy semantics', async t => {
  const { request, records, codes, recoveries } = await setup(t);
  const created = await request('/public/waivers', 'POST', payload());
  const id = verifyWaiverToken(created.data.token, secret).waiverId;
  const w = records.get(id); w.qrToken = null; w.qrUrl = '';
  await request('/public/recovery/request', 'POST', { email: w.participant.email });
  recoveries[0].expiresAt = new Date(0);
  assert.equal((await request('/public/recovery/verify', 'POST', { code: codes[0] })).status, 400);
  await request('/public/recovery/request', 'POST', { email: w.participant.email });
  const session = (await request('/public/recovery/verify', 'POST', { code: codes[1] })).data.session;
  const addition = { attractionId: attractions[2]._id };
  assert.equal((await request(`/public/recovery/waivers/${id}/activities`, 'POST', addition, session)).status, 409);
  assert.equal((await request(`/public/recovery/waivers/${id}/activities`, 'POST', { ...addition, qrToken: created.data.token, originalQrUrl: created.data.qrUrl }, session)).status, 201);
  assert.equal(w.qrToken, created.data.token);
  assert.equal(w.qrUrl, created.data.qrUrl);
  w.assignedAt = new Date('2020-01-01'); w.status = 'approved';
  assert.equal((await request('/public/recovery/waivers', 'GET', undefined, session)).data.length, 0);
  assert.equal((await request(`/public/recovery/waivers/${id}/activities`, 'POST', addition, session)).status, 409);
  w.visitDate = null; w.createdAt = new Date(); w.qrConsumedAt = null;
  assert.equal((await request('/public/recovery/waivers', 'GET', undefined, session)).data.length, 0);
  assert.equal((await request(`/reports/validate/${created.data.token}`, 'GET', undefined, staffToken)).data.valid, true);
  assert.equal((await request(`/reports/validate/${created.data.token}`, 'GET', undefined, staffToken)).data.reason, 'qr_already_used');
  for (let i = 0; i < 3; i++) await request('/public/recovery/request', 'POST', { email: w.participant.email });
  assert.equal((await request('/public/recovery/request', 'POST', { email: w.participant.email })).status, 429);
});

test('eligibility and activity authorization enforce original expiry and explicit validation', () => {
  const w = { visitDate: '2026-10-02', assignedAt: parkDateTime('2026-10-02', '09:00'), status: 'approved' };
  const a = { status: 'approved', validatedAt: new Date(), schedule: { date: '2026-10-02', time: '10:00' } };
  assert.equal(additionalAuthorized(w, a, new Date('2026-10-03T12:00Z')), true);
  assert.equal(additionalAuthorized(w, { ...a, status: 'pending' }, new Date('2026-10-03T12:00Z')), false);
  assert.equal(additionalAuthorized(w, { ...a, status: 'revoked' }, new Date('2026-10-03T12:00Z')), false);
  assert.equal(additionalAuthorized(w, a, new Date('2026-10-04T06:00Z')), false);
  assert.equal(eligibleForAdditional({ ...w, assignedAt: null }, new Date('2026-10-03T12:00Z')), false);
  assert.equal(eligibleForAdditional({ ...w, deletedAt: new Date() }), false);
});
