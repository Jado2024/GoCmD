#!/usr/bin/env node
/* Profilage serveur /api/orders : décompose le temps de la requête en
 * auth/session, Prisma (count, findMany, agrégats), sérialisation JSON.
 * Mission §6.1 : mesurer séparément chaque étape. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const directory = require('../src/lib/user-directory.cjs');

const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-prof-'));
const testDB = path.join(dir, 'prof.db');
fs.copyFileSync(path.join(root, 'db', 'custom.db'), testDB);
const admin = new DatabaseSync(testDB, {readOnly: true}).prepare('SELECT username FROM GoCmdUser WHERE is_root=1').get().username;
process.env.GOCMD_DB_FILE = testDB;
const initial = randomBytes(24).toString('base64url'), password = randomBytes(24).toString('base64url');
directory.createUser(admin, 'prof_sales', initial, ['sales'], {});
directory.changeOwnPassword('prof_sales', initial, password);
delete process.env.GOCMD_DB_FILE;

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
let server, url;
const abort = () => { if (server && server.exitCode === null) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} } };

(async () => {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/start-gocmd-checked.cjs'], {
    cwd: root,
    env: {...process.env, GOCMD_DB_FILE: testDB, GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_REQUIRE_RBAC: '1',
      GOCMD_ACCESS_PASSWORD: '', GOCMD_ALLOW_DEMO_DB: '1', GOCMD_SALES_TAX_RATES_BPS: '0,2000',
      GOCMD_PUBLIC_ORIGIN: url, HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production'},
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvOut = '';
  for (const k of ['stdout', 'stderr']) server[k].on('data', d => { srvOut += d.toString(); });
  for (let i = 0; i < 140; i++) {
    if (server.exitCode !== null) throw new Error('serveur mort: ' + srvOut.slice(-1500));
    try { const r = await fetch(url + '/api/me', {signal: AbortSignal.timeout(1200)}); if (r.status === 401) break; } catch {}
    await new Promise(r => setTimeout(r, 350));
  }
  const r = await fetch(url + '/api/auth/login', {
    method: 'POST', headers: {origin: url, 'content-type': 'application/json'},
    body: JSON.stringify({username: 'prof_sales', password}),
  });
  const cookie = r.headers.get('set-cookie').split(';')[0];

  // Créer 200 commandes réelles pour profiler avec du volume.
  const clients = await (await fetch(url + '/api/clients', {headers: {cookie}})).json();
  const clientId = clients.items?.[0]?.id ?? clients[0]?.id;
  const products = await (await fetch(url + '/api/products?take=200', {headers: {cookie}})).json();
  const items = products.items ?? products;
  const prod = items.find(p => p.family === 'BANQUETTE' && p.unit === 'ml') || items[0];
  let created = 0;
  for (let i = 0; i < 200; i++) {
    const body = {clientId, priority: 'normale', dueDate: '2026-12-31T00:00:00.000Z',
      lines: [{productId: prod.id, qty: 1 + (i % 5), unitPrice: 235}]};
    let resp = await fetch(url + '/api/orders', {
      method: 'POST', headers: {cookie, origin: url, 'content-type': 'application/json'},
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    if (resp.status === 409) {
      const err = await resp.json();
      const token = err.duplicate?.token || err.token;
      resp = await fetch(url + '/api/orders', {
        method: 'POST', headers: {cookie, origin: url, 'content-type': 'application/json'},
        body: JSON.stringify({...body, duplicateReview: {token, reason: 'Profilage volume commande n°' + i}}),
        signal: AbortSignal.timeout(30000),
      });
    }
    if (resp.status === 201) created++;
  }
  console.log(`[setup] ${created}/200 commandes créées`);


  // === Mesure SQL directe : chaque requête de la vue liste (200 orders, page 1) ===
  // Reproduit les 5 requêtes Prisma de GET /api/orders?view=list
  const db = new DatabaseSync(testDB, {readOnly: true});
  function timedSql(label, sql) {
    const t = [];
    for (let i = 0; i < 20; i++) {
      const t0 = process.hrtime.bigint();
      db.prepare(sql).all();
      t.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    t.sort((a, b) => a - b);
    console.log(`[sql] ${label}: min=${t[0].toFixed(2)}ms med=${t[10].toFixed(2)}ms max=${t[19].toFixed(2)}ms`);
    return t[10];
  }
  console.log('— Profil SQL de la vue liste (base 200 commandes) —');
  timedSql('count(where vide)', 'SELECT COUNT(*) n FROM "Order"');
  timedSql('findMany page 50 (index createdAt)', 'SELECT id,ref,status,priority,dueDate,createdAt,clientId FROM "Order" ORDER BY createdAt DESC, id DESC LIMIT 50');
  timedSql('count global', 'SELECT COUNT(*) n FROM "Order"');
  timedSql('count retard', "SELECT COUNT(*) n FROM \"Order\" WHERE status IN ('new','production','ready') AND fulfillmentStatus='open' AND dueDate < datetime('now')");
  timedSql('portfolio SUM join', "SELECT SUM(l.qty*l.unitPrice) v FROM \"OrderLine\" l JOIN \"Order\" o ON o.id=l.orderId WHERE o.status IN ('new','production','ready') AND o.fulfillmentStatus='open'");
  timedSql('lignes par commande (1 ligne)', 'SELECT orderId, qty, unitPrice FROM "OrderLine" WHERE orderId IN (SELECT id FROM "Order" ORDER BY createdAt DESC LIMIT 50)');
  db.close();

  // === Timing HTTP end-to-end détaillé (10 req séquentielles, sans contention) ===
  console.log('— Profil HTTP séquentiel —');
  for (const view of ['view=list&take=50', 'take=50']) {
    const times = [];
    let bytes = 0;
    for (let i = 0; i < 10; i++) {
      const t0 = process.hrtime.bigint();
      const resp = await fetch(url + '/api/orders?' + view, {headers: {cookie}});
      const b = await resp.text();
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      bytes = b.length;
    }
    times.sort((a, b) => a - b);
    console.log(`[http] ${view}: min=${times[0].toFixed(0)}ms med=${times[5].toFixed(0)}ms max=${times[9].toFixed(0)}ms respBytes=${bytes}`);
  }
  console.log('PROFILING_DONE');
})().catch(e => { console.error('FAIL:', e.stack || e); process.exitCode = 1; }).finally(() => { abort(); try { fs.rmSync(dir, {recursive: true, force: true}); } catch {} });
