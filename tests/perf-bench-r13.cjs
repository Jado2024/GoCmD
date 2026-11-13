#!/usr/bin/env node
/* Benchmark de performance HTTP GoCmd R12→R13 (mission §6).
 * Mesure p50/p95/p99, débit, erreurs HTTP sur /api/orders (liste compacte
 * et détail) sous charge nominale (2/5/10/20/50 utilisateurs simulés).
 * Serveur de production local sur copie jetable de la base DEMO enrichie
 * (les commandes créées augmentent le volume au fil des vagues).
 * Usage : node tests/perf-bench-r13.cjs [--waves 2,5,10,20,50] [--out fichier.json]
 */
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
const waves = flag('waves', '2,5,10,20,50').split(',').map(Number);
const outJson = flag('out', '');
const label = flag('label', 'run');

// — Comptes de charge : plusieurs sessions nominatives par vague.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-perf-'));
const testDB = path.join(dir, 'perf.db');
fs.copyFileSync(path.join(root, 'db', 'custom.db'), testDB);

const WAVE_USERS = [];
{
  const admin = new DatabaseSync(testDB, {readOnly: true})
    .prepare('SELECT username FROM GoCmdUser WHERE is_root=1').get()?.username;
  const db = new DatabaseSync(testDB, {readOnly: true});
  db.close();
  const prev = process.env.GOCMD_DB_FILE;
  process.env.GOCMD_DB_FILE = testDB;
  const maxU = Math.max(...waves);
  for (let i = 0; i < maxU; i++) {
    const username = 'perf_u' + String(i).padStart(2, '0');
    const initial = randomBytes(24).toString('base64url');
    const password = randomBytes(24).toString('base64url');
    directory.createUser(admin, username, initial, ['sales', 'approver'], {});
    directory.changeOwnPassword(username, initial, password);
    WAVE_USERS.push({username, password});
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

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function login(origin, user) {
  const r = await fetch(origin + '/api/auth/login', {
    method: 'POST', headers: {origin, 'content-type': 'application/json'},
    body: JSON.stringify(user), signal: AbortSignal.timeout(9000),
  });
  if (r.status !== 200) throw new Error('login failed ' + r.status);
  return r.headers.get('set-cookie').split(';')[0];
}

// UNE requête métier = liste compacte (view=list, contrat UI) + lecture résumé.
async function listOnce(origin, cookie) {
  const t0 = process.hrtime.bigint();
  const r = await fetch(origin + '/api/orders?view=list&take=50', {
    headers: {cookie, accept: 'application/json'},
    signal: AbortSignal.timeout(30000),
  });
  const body = await r.text();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return {ms, status: r.status, bytes: body.length};
}

async function runWave(origin, cookies, nUsers, perUser) {
  const results = [];
  const errors = {http4xx: 0, http5xx: 0, network: 0};
  await Promise.all(Array.from({length: nUsers}, async (_, u) => {
    const cookie = cookies[u % cookies.length];
    for (let i = 0; i < perUser; i++) {
      try {
        const res = await listOnce(origin, cookie);
        results.push(res.ms);
        if (res.status >= 500) errors.http5xx++;
        else if (res.status >= 400) errors.http4xx++;
      } catch (e) {
        errors.network++;
      }
    }
  }));
  results.sort((a, b) => a - b);
  const wall = results.length ? results.reduce((a, b) => a + b, 0) : 0;
  return {
    nUsers, requests: results.length, errors,
    p50: percentile(results, 50), p95: percentile(results, 95), p99: percentile(results, 99),
    max: results.length ? results[results.length - 1] : null,
    mean: results.length ? wall / results.length : null,
  };
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

  // Sessions nominatives (une par utilisateur max, réutilisées par vague).
  const maxU = Math.max(...waves);
  const cookies = [];
  for (let i = 0; i < maxU; i++) cookies.push(await login(url, WAVE_USERS[i]));

  const report = {label, startedAt: new Date().toISOString(), waves: []};
  // Échauffement JIT/Prisma/session (non compté).
  await runWave(url, cookies, 2, 3);
  for (const n of waves) {
    const perUser = n >= 20 ? 10 : 20; // charge totale comparable entre vagues
    const w = await runWave(url, cookies, n, perUser);
    const count = new DatabaseSync(testDB, {readOnly: true}).prepare('SELECT COUNT(*) n FROM "Order"').get().n;
    w.ordersInDb = count;
    report.waves.push(w);
    console.log(`[perf] users=${n} req=${w.requests} p50=${w.p50?.toFixed(0)}ms p95=${w.p95?.toFixed(0)}ms p99=${w.p99?.toFixed(0)}ms err=${JSON.stringify(w.errors)} orders=${count}`);
  }
  if (outJson) fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  console.log('PERF_BENCH_DONE');
})().catch(e => { console.error('FAIL perf bench:', e.stack || e); process.exitCode = 1; }).finally(() => { abort(); try { fs.rmSync(dir, {recursive: true, force: true}); } catch {} });
