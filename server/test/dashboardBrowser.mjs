// Optional isolated browser integration. Never connects to production.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const require = createRequire(`${root}/server/package.json`);
const mongoose = require('mongoose');
const express = require('express');
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH ? createRequire(process.env.PLAYWRIGHT_MODULE_PATH + '/package.json')('playwright') : require('playwright');
const { createServer } = await import(`${root}/client/node_modules/vite/dist/node/index.js`);
const { adminRoutes } = await import(`${root}/server/src/routes/admin.js`);
const { publicRoutes } = await import(`${root}/server/src/routes/public.js`);
const { reportRoutes } = await import(`${root}/server/src/routes/reports.js`);
const { authRoutes } = await import(`${root}/server/src/routes/auth.js`);
const { signAuthToken } = await import(`${root}/server/src/lib/auth.js`);
const { parkDate, parkDateTime } = await import(`${root}/shared/visitSchedule.js`);
const { Waiver } = await import(`${root}/server/src/models/Waiver.js`);
const { Attraction } = await import(`${root}/server/src/models/Attraction.js`);
const { User } = await import(`${root}/server/src/models/User.js`);
const directory = await mkdtemp(`${tmpdir()}/dashboard-ui-`);
const mongo = spawn(process.env.TEST_MONGOD_BINARY || '/opt/homebrew/bin/mongod', ['--dbpath', directory, '--port', '27984', '--bind_ip', '127.0.0.1', '--nounixsocket'], { stdio: 'ignore' });
let server, vite, browser;
try {
  await mongoose.connect('mongodb://127.0.0.1:27984/ui_test', { serverSelectionTimeoutMS: 15000 });
  const user = await User.create({ name: 'UI Test Admin', email: 'ui@example.test', passwordHash: 'test-only', role: 'admin', active: true });
  const token = signAuthToken(user, 'test-only');
  let metricRequests = 0, failNext = false;
  const app = express(); app.use(express.json());
  app.use('/api/admin/reports/metrics', (req, res, next) => { metricRequests++; if (failNext) { failNext = false; return res.status(503).json({ error: 'Error temporal de prueba aislada' }); } next(); });
  app.use('/api/admin', adminRoutes({ jwtSecret: 'test-only' }));
  app.use('/api/reports', reportRoutes({ jwtSecret: 'test-only' }));
  app.use('/api/public', publicRoutes({ jwtSecret: 'test-only' }));
  app.use('/api/auth', authRoutes({ jwtSecret: 'test-only' }));
  const attractionId = new mongoose.Types.ObjectId();
  await Attraction.collection.insertOne({ _id: attractionId, name: 'Atracción de prueba aislada' });
  const makeRecord = () => ({ createdAt: parkDateTime(parkDate(), '10:00'), status: 'pending', attractionId, attractionIds: [attractionId, attractionId], participant: { fullName: 'Prueba local', email: 'test@example.test', nationality: 'México', cityState: 'Chihuahua, Chihuahua' } });
  await Waiver.collection.insertMany(Array.from({ length: 12 }, makeRecord));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  vite = await createServer({ root: `${root}/client`, configFile: `${root}/client/vite.config.js`, server: { host: '127.0.0.1', port: 5194, proxy: { '/api': { target: `http://127.0.0.1:${server.address().port}` } } } }); await vite.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.TEST_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ token, user }) => { localStorage.setItem('authToken', token); localStorage.setItem('authUser', JSON.stringify(user)); }, { token, user: { name: user.name, email: user.email, role: 'admin' } });
  await page.clock.install();
  async function settled() { await page.getByRole('button', { name: 'Actualizar', exact: true }).waitFor(); await page.waitForFunction(() => !document.querySelector('.dashboard button:disabled')); }
  async function back() { await page.getByRole('button', { name: 'Volver al Dashboard', exact: true }).click(); await settled(); }
  async function clickAndCheck(locator, expected) {
    const response = page.waitForResponse(r => r.url().includes('/admin/reports/waivers?'));
    await locator.click(); const data = await (await response).json(); assert.equal(data.total, expected);
    await page.waitForFunction(n => document.querySelector('.report-table tbody').children.length === Math.min(n, 10), expected);
    assert.equal(await page.locator('.dashboard').count(), 0);
    await back();
  }
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.goto('http://127.0.0.1:5194/admin'); await settled();
    assert.equal(await page.locator('.stat').count(), 4);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    if (process.env.DASHBOARD_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DASHBOARD_SCREENSHOT_DIR}/dashboard-stage3-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Periodo anterior', exact: true }).click(); await settled();
  const anchor = await page.locator('.dashboard input[type=date]').inputValue();
  await clickAndCheck(page.locator('.stat').first(), 12);
  assert.equal(await page.locator('.dashboard input[type=date]').inputValue(), anchor);
  await page.reload(); await settled(); assert.equal(await page.locator('.dashboard input[type=date]').inputValue(), anchor);
  await page.getByRole('button', { name: 'Periodo actual', exact: true }).click(); await settled();
  for (let i = 0; i < 4; i++) await clickAndCheck(page.locator('.stat').nth(i), 12);
  await page.locator('.historical').click();
  await page.getByText('Coincidencias:', { exact: false }).waitFor();
  assert.ok(page.url().includes('expectedTotal=12'));
  await page.reload(); await page.getByText('Coincidencias:', { exact: false }).waitFor();
  assert.equal(await page.locator('.report-table tbody tr').count(), 10);
  await back();
  await page.goBack(); await page.getByText('Coincidencias:', { exact: false }).waitFor();
  await back();
  await clickAndCheck(page.locator('.legend-link').first(), 12);
  await clickAndCheck(page.locator('.breakdowns .bar-link').first(), 12);
  await clickAndCheck(page.locator('.breakdowns .panel').nth(1).locator('.bar-link').first(), 12);
  await page.getByRole('button', { name: 'Día', exact: true }).click(); await settled();
  await clickAndCheck(page.locator('.trend-chart a').nth(10), 12);
  await page.locator('summary').click(); await clickAndCheck(page.locator('.table-scroll tbody tr').nth(10).getByRole('button'), 12);
  const saved = await page.locator('.updated').innerText();
  failNext = true; await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await page.getByRole('alert').waitFor(); assert.equal(await page.locator('.stat').count(), 4); assert.equal(await page.locator('.updated').innerText(), saved);
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click(); await settled(); assert.equal(await page.getByRole('alert').count(), 0);
  await Waiver.collection.insertOne(makeRecord());
  // A stale metric must not show a list with a different total.
  await page.locator('.historical').click(); await page.getByText('Los registros cambiaron desde la consulta de la métrica.', { exact: false }).waitFor();
  assert.equal(await page.locator('.report-table tbody tr').count(), 0);
  const stopped = metricRequests; await page.clock.runFor(60000); assert.equal(metricRequests, stopped);
  await back(); assert.equal(await page.locator('.stat strong').first().innerText(), '13');
  await Waiver.collection.insertOne(makeRecord());
  await page.clock.runFor(30000); await page.waitForFunction(() => document.querySelector('.stat strong')?.textContent === '14');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = metricRequests; await page.clock.runFor(60000); assert.equal(metricRequests, hidden);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => !document.querySelector('.dashboard button:disabled')); assert.ok(metricRequests > hidden);
  await User.updateOne({ _id: user._id }, { role: 'staff' });
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click(); await page.waitForURL('**/staff');
  const revoked = metricRequests; await page.clock.runFor(60000); assert.equal(metricRequests, revoked); assert.equal(await page.locator('.dashboard').count(), 0);
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  const loggedOut = metricRequests; await page.clock.runFor(60000); assert.equal(metricRequests, loggedOut);
  assert.deepEqual(errors, []);
  console.log('Dashboard UI passed: real MongoDB fixtures; all drilldowns, historical return, manual error/retry, 30s polling, visibility, mismatch guard, role change, 3 viewport sizes.');

} finally {
  await browser?.close(); await vite?.close(); if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect(); if (mongo.exitCode === null) { mongo.kill(); await once(mongo, 'exit'); } await rm(directory, { recursive: true, force: true });
}
