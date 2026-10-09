import { metricReportFilters } from '../../client/src/lib/dashboardInteractions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import express from 'express';
import mongoose from 'mongoose';
import { Waiver } from '../src/models/Waiver.js';
import { User } from '../src/models/User.js';
import { Attraction } from '../src/models/Attraction.js';
import { adminRoutes } from '../src/routes/admin.js';
import { signAuthToken } from '../src/lib/auth.js';
import { dashboardMetrics } from '../src/lib/dashboardMetrics.js';
import { waiverAdminReportFilter } from '../src/lib/waiverReportFilters.js';
import { parkDateTime } from '../../shared/visitSchedule.js';
const binary = process.env.TEST_MONGOD_BINARY || ['/opt/homebrew/bin/mongod', '/usr/bin/mongod'].find(existsSync);
test('real MongoDB metrics, shared list filters and administrative authorization', { skip: !binary && 'Install mongod or set TEST_MONGOD_BINARY' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waiver-metrics-'));
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const mongo = spawn(binary, ['--dbpath', directory, '--port', String(port), '--bind_ip', '127.0.0.1', '--nounixsocket'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; mongo.stdout.on('data', chunk => logs += chunk); mongo.stderr.on('data', chunk => logs += chunk);
  t.after(async () => { await mongoose.disconnect(); if (mongo.exitCode === null) { mongo.kill('SIGTERM'); await once(mongo, 'exit'); } await rm(directory, { recursive: true, force: true }); });
  await mongoose.connect(`mongodb://127.0.0.1:${port}/metrics_test`, { serverSelectionTimeoutMS: 15000 }).catch(error => { throw new Error(`${error.message}\n${logs}`); });
  const attractionId = new mongoose.Types.ObjectId(), otherId = new mongoose.Types.ObjectId();
  await Attraction.collection.insertOne({ _id: attractionId, name: 'Test attraction' });
  const now = parkDateTime('2026-10-09', '12:00');
  const rows = Array.from({ length: 305 }, (_, i) => ({
    createdAt: parkDateTime('2026-10-09', i % 2 ? '23:59' : '00:00'),
    status: ['pending', 'signed', 'approved', 'rejected', 'revoked'][i % 5],
    attractionId, attractionIds: [attractionId, attractionId, otherId],
    additionalActivities: [{ attractionId: new mongoose.Types.ObjectId() }],
    participant: { nationality: 'México', cityState: 'Chihuahua, Chihuahua' }
  }));
  rows.push(
    { createdAt: parkDateTime('2026-10-10'), status: 'approved', deletedAt: null },
    { createdAt: parkDateTime('2026-10-09'), status: 'approved', deletedAt: now },
    { createdAt: parkDateTime('2025-01-01'), status: 'signed', attractionId },
    { createdAt: now, status: 'unexpected', participant: { nationality: 'México', cityState: ' , Chihuahua' } },
    { createdAt: now, status: 'pending', participant: { nationality: 'Estados Unidos', cityState: 'Austin' } },
    { createdAt: now, status: 'pending', participant: { nationality: 'Otra', cityState: 'Unknown' } },
    { createdAt: now, status: 'pending' }
  );
  await Waiver.collection.insertMany(rows);
  const metrics = await dashboardMetrics({ granularity: 'day', anchor: '2026-10-09' }, now);
  assert.equal(metrics.total, 309); assert.equal(metrics.historicalTotal, 311);
  assert.equal(metrics.current.day.total, 309); assert.equal(metrics.current.year.total, 310);
  assert.equal(metrics.series.reduce((n, b) => n + b.count, 0), 309);
  assert.equal(metrics.states.reduce((n, b) => n + b.count, 0), 309);
  assert.equal(metrics.states.find(s => s.status === 'pending').count, 125);
  assert.equal(metrics.states.find(s => s.status === 'other').count, 1);
  assert.equal(metrics.attractions.find(a => String(a.attractionId) === String(attractionId)).count, 305);
  assert.equal(metrics.attractions.find(a => !a.attractionId).count, 4);
  assert.equal(metrics.provenance.find(p => p.category === 'Chihuahua').count, 305);
  assert.equal(metrics.provenance.find(p => p.category === 'Procedencia no clasificable').count, 2);
  assert.equal(metrics.provenance.find(p => p.category === 'Extranjero').count, 1);
  for (const selection of [{}, { status: 'pending' }, { attractionId: String(otherId) }, { provenance: 'Chihuahua' }, { attraction: 'none' }, { status: 'other' }]) {
    const filtered = await dashboardMetrics({ granularity: 'day', anchor: '2026-10-09', ...selection }, now);
    const total = await Waiver.countDocuments(waiverAdminReportFilter({ query: { from: '2026-10-09', to: '2026-10-09', ...selection } }));
    assert.equal(filtered.total, total);
    assert.equal(filtered.historicalTotal, 311);
  }
  const empty = await dashboardMetrics({ anchor: '2020-01-01' }, now);
  assert.equal(empty.total, 0); assert.ok(empty.series.every(b => b.count === 0));
  assert.ok(empty.states.every(b => b.percentage === 0));
  const hourly = metrics.series[0];
  assert.equal(await Waiver.countDocuments(waiverAdminReportFilter({ query: { from: hourly.start.toISOString(), until: hourly.end.toISOString() } })), hourly.count);
  for (const [kind, items] of [ ['state', metrics.states], ['attraction', metrics.attractions], ['provenance', metrics.provenance], ['interval', metrics.series], ['current', Object.values(metrics.current)] ]) {
    for (const item of items) {
      const count = await Waiver.countDocuments(waiverAdminReportFilter({ query: metricReportFilters(metrics, kind, item) }));
      assert.equal(count, kind === 'current' ? item.total : item.count, `${kind}: exact drilldown`);
    }
  }
  assert.equal(await Waiver.countDocuments(waiverAdminReportFilter({ query: metricReportFilters(metrics, 'historical') })), metrics.historicalTotal);
  const previous = await dashboardMetrics({ granularity: 'year', anchor: '2025-01-01' }, now);
  assert.equal(previous.total, 1); assert.equal(previous.current.day.total, 309);
  const app = express(); app.use('/api/admin', adminRoutes({ jwtSecret: 'test-only' }));
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (query = '', token = '') => fetch(`http://127.0.0.1:${server.address().port}/api/admin/reports/metrics${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal((await request()).status, 401);
  for (const role of ['admin', 'staff', 'taquilla']) {
    const user = await User.create({ name: 'Local test', email: `${role}@example.test`, passwordHash: 'test-only', role, active: true });
    const token = signAuthToken(user, 'test-only');
    assert.equal((await request('?anchor=2026-10-09', token)).status, role === 'admin' ? 200 : 403);
    if (role === 'admin') {
      const list = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/reports/waivers?from=2026-10-09&to=2026-10-09&attractionId=${otherId}`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(list.status, 200); assert.equal((await list.json()).total, 305);
      const csv = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/reports/waivers/export.csv?from=2026-10-09&to=2026-10-09&provenance=Chihuahua`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(csv.status, 200); assert.equal((await csv.text()).trim().split('\n').length, 306);
      assert.equal((await request('?anchor=bad', token)).status, 400);
      assert.equal((await request('?granularity=invalid', token)).status, 400);
      await User.updateOne({ _id: user._id }, { active: false });
      assert.equal((await request('', token)).status, 401);
    }
  }
});
