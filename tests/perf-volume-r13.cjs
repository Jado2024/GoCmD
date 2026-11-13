#!/usr/bin/env node
/* Mesure p95 sur /api/orders avec volume réaliste : crée N commandes via
 * l'API HTTP (compte sales), mesure les listes compacte ET détaillée,
 * puis rejoue la vague 50 utilisateurs. Mission §6.1 : mesurer séparement
 * liste compacte (view=list) et mode détail (GET sans view, inclut lignes). */
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
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const N_ORDERS = Number(flag('orders', '200'));
const outJson = flag('out', '');
const label = flag('label', 'volume');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-perfvol-'));
const testDB = path.join(dir, 'perf.db');
fs.copyFileSync(path.join(root, 'db', 'custom.db'), testDB);

const USERS = {SALES: null, APPROVER: null, VIEWERS: []};
{
  const admin = new DatabaseSync(testDB, {readOnly: true})
    .prepare('SELECT username FROM GoCmdUser WHERE is_root=1').get()?.username;
  const prev = process.env.GOCMD_DB_FILE;
  process.env.GOCMD_DB_FILE = testDB;
  for (const spec of [['sales_u1', ['sales']], ['approver_u1', ['approver']]]) {
    const initial = randomBytes(24).toString('base64url');
    const password = randomBytes(24).toString('base64url');
    directory.createUser(admin, spec[0], initial, spec[1], {});
    directory.changeOwnPassword(spec[0], initial, password);
    USERS[spec[0] === 'sales_u1' ? 'SALES' : 'APPROVER'] = {username: spec[0], password};
  }
  for (let i = 0; i < 50; i++) {
    const name = 'viewer' + String(i).padStart(2, '0');
    const initial = randomBytes(24).toString('base64url');
    const password = randomBytes(24).toString('base64url');
    directory.createUser(admin, name, initial, ['sales'], {});
    directory.changeOwnPassword(name, initial, password);
    USERS.VIEWERS.push({username: name, password});
  }
  if (prev === undefined) delete process.env.GOCMD_DB_FILE; else process.env.GOCMD_DB_FILE = prev;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}
function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))];
}
async function login(origin, user) {
  const r = await fetch(origin + '/api/auth/login', {
    method: 'POST', headers: {origin, 'content-type': 'application/json'},
    body: JSON.stringify(user), signal: AbortSignal.timeout(9000),
  });
  if (r.status !== 200) throw new Error('login failed ' + r.status);
  return r.headers.get('set-cookie').split(';')[0];
}

let server, url;
const abort = () => { if (server && server.exitCode === null) { try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill('SIGTERM'); } catch {} } } };

(async () => {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/start-gocmd-checked.cjs'], {
    cwd: root,
    env: {
      ...process.env,
      GOCMD_DB_FILE: testDB, GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_REQUIRE_RBAC: '1',
      GOCMD_ACCESS_PASSWORD: '', GOCMD_ALLOW_DEMO_DB: '1',
      GOCMD_SALES_TAX_RATES_BPS: '0,2000',
      GOCMD_PUBLIC_ORIGIN: url, HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production',
    },
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvOut = '';
  for (const k of ['stdout', 'stderr']) server[k].on('data', d => { srvOut += d.toString(); });
  let ready = false;
  for (let i = 0; i < 140; i++) {
    if (server.exitCode !== null) throw new Error('serveur mort: ' + srvOut.slice(-1500));
    try { const r = await fetch(url + '/api/me', {signal: AbortSignal.timeout(1200)}); if (r.status === 401) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 350));
  }
  if (!ready) throw new Error('serveur non prêt');

  const salesCookie = await login(url, USERS.SALES);
  // Créer N_ORDERS commandes réelles via API (volume réaliste, avec lignes).
  const clients = await (await fetch(url + '/api/clients', {headers: {cookie: salesCookie}})).json();
  const clientId = clients.items?.[0]?.id ?? clients[0]?.id;
  const products = await (await fetch(url + '/api/products?take=200', {headers: {cookie: salesCookie}})).json();
  const prod = (products.items ?? products).find(p => p.unit === 'ml' && p.family === 'SALON') ||
               (products.items ?? products).find(p => p.family === 'MATelas' || p.unit === 'ml') ||
               (products.items ?? products)[0];
  let created = 0, conflicts = 0;
  const tCreate0 = Date.now();
  for (let i = 0; i < N_ORDERS; i++) {
    const body = {
      clientId, priority: 'normale', dueDate: '2026-12-31T00:00:00.000Z',
      lines: [{productId: prod.id, qty: 1 + (i % 5), unitPrice: 235}],
    };
    const r = await fetch(url + '/api/orders', {
      method: 'POST', headers: {cookie: salesCookie, origin: url, 'content-type': 'application/json'},
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    if (r.status === 201) created++;
    else if (r.status === 409) {
      // doublon potentiel (même jour, même client) : confirmation motivée
      const err = await r.json();
      const token = err.duplicate?.token || err.token;
      const r2 = await fetch(url + '/api/orders', {
        method: 'POST', headers: {cookie: salesCookie, origin: url, 'content-type': 'application/json'},
        body: JSON.stringify({...body, duplicateReview: {token, reason: 'Recette de charge : commande de volume numero ' + i + ' reellement distincte des precedentes.'}}),
        signal: AbortSignal.timeout(30000),
      });
      if (r2.status === 201) created++; else conflicts++;
    } else { conflicts++; }
  }
  const createMs = Date.now() - tCreate0;
  console.log(`[volume] ${created} commandes creees en ${createMs}ms (${(createMs / Math.max(1, created)).toFixed(0)} ms/cmd), ${conflicts} echecs`);

  // Sessions viewers
  const cookies = [];
  for (const v of USERS.VIEWERS) cookies.push(await login(url, v));

  async function bench(pathQ, nUsers, perUser) {
    const times = [];
    const errors = {http4xx: 0, http5xx: 0, network: 0};
    let bytes = 0;
    await Promise.all(Array.from({length: nUsers}, async (_, u) => {
      const cookie = cookies[u % cookies.length];
      for (let i = 0; i < perUser; i++) {
        const t0 = process.hrtime.bigint();
        try {
          const r = await fetch(url + pathQ, {headers: {cookie}, signal: AbortSignal.timeout(30000)});
          const b = await r.text();
          times.push(Number(process.hrtime.bigint() - t0) / 1e6);
          bytes = b.length;
          if (r.status >= 500) errors.http5xx++; else if (r.status >= 400) errors.http4xx++;
        } catch { errors.network++; }
      }
    }));
    times.sort((a, b) => a - b);
    return {path: pathQ, nUsers, requests: times.length, errors, bytesLast: bytes,
      p50: pct(times, 50), p95: pct(times, 95), p99: pct(times, 99), max: times[times.length - 1] ?? null};
  }

  const report = {label, ordersCreated: created, startedAt: new Date().toISOString(), benches: []};
  // Échauffement
  await bench('/api/orders?view=list&take=50', 2, 3);
  // 1) liste compacte sous charge 50
  report.benches.push(await bench('/api/orders?view=list&take=50', 50, 10));
  // 2) mode détail historique (include complet) sous charge 50
  report.benches.push(await bench('/api/orders?take=50', 50, 10));
  // 3) pagination profonde (offset élevé) liste compacte
  report.benches.push(await bench('/api/orders?view=list&take=50&skip=150', 50, 10));
  // 4) détail avec recherche
  report.benches.push(await bench('/api/orders?take=50&q=CMD', 50, 10));
  for (const b of report.benches) {
    console.log(`[perf] ${b.path} users=50 req=${b.requests} p50=${b.p50?.toFixed(0)}ms p95=${b.p95?.toFixed(0)}ms p99=${b.p99?.toFixed(0)}ms err=${JSON.stringify(b.errors)} respBytes=${b.bytesLast}`);
  }
  if (outJson) fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  console.log('PERF_VOLUME_DONE');
})().catch(e => { console.error('FAIL:', e.stack || e); process.exitCode = 1; }).finally(() => { abort(); try { fs.rmSync(dir, {recursive: true, force: true}); } catch {} });
