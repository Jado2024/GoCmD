#!/usr/bin/env node
/* GoCmd — NON-RÉGRESSION OF-SNAP-01 (audit 10/11/2026, règle métier SODEPI §7).
 * « Dimensions, composition et instructions techniques doivent être conservées
 * dans la CMD et transmises INTÉGRALEMENT aux OF. »
 *
 * Avant correction, le snapshot OF omettait : upholstery (banquettes),
 * foamLayers (composition en couches des mélanges), foamNature/foamGrade/
 * foamDensity et les dimensions catalogue. Un matelas « MELANGE » perdait
 * son détail de couches sur la fiche d'atelier.
 *
 * Exécution réelle : serveur Next.js isolé + copie jetable de la base démo.
 */
'use strict';
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createAccounts, loginAccounts } = require('./qa-managed-accounts.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-ofsnap-'));
const testDB = path.join(dir, 'ofsnap.db');
fs.copyFileSync(path.join(root, 'db', 'custom.db'), testDB);
const db = new DatabaseSync(testDB);

const accounts = createAccounts(testDB, 'ofsnap', { SALES: ['sales'] });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}
async function waitReady(s, u) {
  for (let i = 0; i < 200; i++) {
    if (s.exitCode !== null) throw new Error(`Serveur exit ${s.exitCode}`);
    try { const r = await fetch(`${u}/api/me`, { signal: AbortSignal.timeout(1500) }); if (r.status === 401) return; } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('serveur non prêt');
}
async function main() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['scripts/start-gocmd-checked.cjs'], {
    cwd: root, detached: process.platform !== 'win32',
    env: {
      ...process.env, GOCMD_DB_FILE: testDB, GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_REQUIRE_RBAC: '1',
      GOCMD_ACCESS_PASSWORD: '', GOCMD_ALLOW_DEMO_DB: '1',
      GOCMD_PUBLIC_ORIGIN: url, HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {}); server.stderr.on('data', () => {});
  try {
    await waitReady(server, url);
    const cookies = await loginAccounts(url, accounts);
    const cookie = cookies.SALES;

    // Fixture : matelas MELANGE (couches de mousse) au prix catalogue.
    const fixture = db.prepare(`SELECT p.id, p.unitPrice, p.foamLayers, p.length, p.width, p.height
      FROM Product p WHERE p.family='MATELAS' AND p.status='active' AND p.foamComposition='MELANGE'
      AND p.foamLayers IS NOT NULL ORDER BY p.id LIMIT 1`).get();
    assert(fixture, 'fixture matelas MELANGE requis (catalogue démo)');
    const expectedLayers = JSON.parse(fixture.foamLayers);

    // CMD avec dimensions personnalisées + instructions techniques :
    // exception technique → pending_validation → pas d'OF ; puis validation
    // approbateur (quatre-yeux : compte distinct du créateur) → OF émis.
    const orderBody = {
      clientId: 1, dueDate: new Date(Date.now() + 14 * 864e3).toISOString(), priority: 'normale',
      lines: [{
        productId: fixture.id, qty: 1, unitPrice: fixture.unitPrice,
        dimensions: { lengthCm: 185, widthCm: 90, heightCm: fixture.height },
        technicalInstructions: 'Audit OF-SNAP : couture renforcée côté pieds',
      }],
    };
    let r = await fetch(new URL('/api/orders', url), {
      method: 'POST', headers: { origin: url, cookie, 'content-type': 'application/json' },
      body: JSON.stringify(orderBody), signal: AbortSignal.timeout(30000),
    });
    assert.equal(r.status, 201, 'création CMD: ' + r.status);
    const order = (await r.json()).order;
    assert.equal(order.status, 'pending_validation', 'exception technique → validation');
    assert.equal((await db.prepare('SELECT COUNT(*) c FROM WorkOrder WHERE orderId=?').get(order.id)).c, 0,
      'aucun OF avant validation');

    // Validation par un approbateur (compte dédié, ≠ créateur).
    const approver = createAccounts(testDB, 'ofsnapb', { APPROVER: ['approver'] }).APPROVER;
    const lr = await fetch(new URL('/api/auth/login', url), {
      method: 'POST', headers: { origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ username: approver.username, password: approver.password }),
    });
    assert.equal(lr.status, 200, 'login approver');
    const approverCookie = (lr.headers.get('set-cookie') || '').split(';')[0];
    r = await fetch(new URL(`/api/orders/${order.id}`, url), {
      method: 'PATCH', headers: { origin: url, cookie: approverCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve', comment: 'validation technique OF-SNAP' }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(r.status, 200, 'approbation: ' + r.status + ' ' + (await r.text()).slice(0, 200));

    // L'OF doit porter la composition INTÉGRALE (règle SODEPI §7).
    const of = db.prepare('SELECT snapshotJson FROM WorkOrder WHERE orderId=?').get(order.id);
    assert(of, 'OF émis après validation');
    const snap = JSON.parse(of.snapshotJson);
    assert.equal(snap.orderRef, order.ref, 'référence CMD');
    assert.equal(snap.product.technicalInstructions, 'Audit OF-SNAP : couture renforcée côté pieds',
      'instructions techniques transmises à l\'OF');
    assert.deepEqual(snap.product.dimensions, { lengthCm: 185, widthCm: 90, heightCm: fixture.height },
      'dimensions PERSONNALISÉES transmises à l\'OF');
    assert.deepEqual(snap.product.catalogDimensions, { lengthCm: fixture.length, widthCm: fixture.width, heightCm: fixture.height },
      'dimensions catalogue présentes (référence d\'atelier)');
    assert.ok(Array.isArray(snap.product.foamLayers) && snap.product.foamLayers.length === expectedLayers.length,
      'foamLayers (composition MELANGE) transmis à l\'OF');
    assert.deepEqual(snap.product.foamLayers, expectedLayers, 'couches de mélange INTÉGRALES');
    assert.equal(snap.product.foamComposition, 'MELANGE', 'composition globale');
    assert.equal(snap.product.upholstery, null, 'garnissage banquette présent (null pour un matelas)');
    assert.equal(snap.product.foamDensity, null, 'densité présente (null si mélange)');

    // Témoin banquette : le champ upholstery doit circuler jusqu'à l'OF.
    const banquet = db.prepare(`SELECT p.id, p.unitPrice, p.upholstery FROM Product p
      WHERE p.family='BANQUETTE' AND p.status='active' AND p.upholstery IS NOT NULL ORDER BY p.id LIMIT 1`).get();
    assert(banquet, 'fixture banquette requise');
    r = await fetch(new URL('/api/orders', url), {
      method: 'POST', headers: { origin: url, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 1, dueDate: new Date(Date.now() + 14 * 864e3).toISOString(), priority: 'normale',
        lines: [{ productId: banquet.id, qty: 1, unitPrice: banquet.unitPrice }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(r.status, 201, 'création CMD banquette');
    const bOrder = (await r.json()).order;
    // CASCADE3 (11/11/2026) — P1FIX : une commande standard (aucune exception)
    // naît elle aussi pending_validation : aucun OF avant le visa quatre-yeux.
    const bOfNone = db.prepare('SELECT COUNT(*) c FROM WorkOrder WHERE orderId=?').get(bOrder.id).c;
    assert.equal(bOfNone, 0, 'aucun OF avant approbation (commande standard, P1FIX)');
    r = await fetch(new URL(`/api/orders/${bOrder.id}`, url), {
      method: 'PATCH', headers: { origin: url, cookie: approverCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve', comment: 'Validation quatre-yeux OF-SNAP banquette' }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(r.status, 200, 'approbation banquette: ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const bOf = db.prepare('SELECT snapshotJson FROM WorkOrder WHERE orderId=?').get(bOrder.id);
    assert(bOf, 'OF banquette émis après validation');
    const bSnap = JSON.parse(bOf.snapshotJson);
    assert.equal(bSnap.product.upholstery, banquet.upholstery, 'upholstery banquette transmis à l\'OF');

    console.log('PASS OF-SNAP-01 : snapshot OF intégral (couches, garnissage, densité, dimensions, instructions)');
  } finally {
    try { process.kill(-server.pid, 'SIGKILL'); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(e => { console.error('FAIL OF-SNAP-01 :', e.message); process.exit(1); });
