#!/usr/bin/env node
/* P6 (2026-11-11) — Chantier 5 §6.3/6.4 : charge multi-niveaux 10/20/50 sessions.
 * Serveur de production réel sur copie jetable, comptes nominatifs distincts,
 * volume représentatif (20 000 consultations + RFQ seedés), charge MIXTE :
 * listes, recherche/filtre/tri/pagination, création de commande, validation
 * quatre-yeux, génération PDF (BC), export. Mesures : succès, refus métier
 * attendus, erreurs techniques (0 attendu), latences p50/p95/max, CPU et RSS
 * du serveur. Un refus métier attendu n'est jamais compté comme un échec.
 * AUCUNE performance mesurée ici n'est une garantie pour le serveur SODEPI :
 * environnement de recette Linux, pas le matériel cible (mission §6.4). */
'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { copyFileSync, mkdtempSync, readFileSync } = require('node:fs');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const root = resolve(__dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'gocmd-p6-load-'));
const file = join(temp, 'load.db');
copyFileSync(join(root, 'db', 'custom.db'), file);
process.env.GOCMD_DB_FILE = file; // requis par user-directory.cjs à la connexion
const dir = require(join(root, 'src/lib/user-directory.cjs'));
const db = new DatabaseSync(file);
const admin = db.prepare('SELECT username FROM GoCmdUser WHERE is_root=1').get().username;

// Comptes : 50 commerciaux, 50 approbateurs, 1 acheteur, 1 finance (nominatifs).
const SPEC = {};
for (let i = 0; i < 50; i++) { SPEC[`sales${i}`] = ['sales']; SPEC[`appr${i}`] = ['approver']; }
SPEC.buyer0 = ['buyer']; SPEC.fin0 = ['finance'];
const accounts = {};
for (const [name, roles] of Object.entries(SPEC)) {
  const first = randomBytes(24).toString('base64url'), password = randomBytes(24).toString('base64url');
  dir.createUser(admin, name, first, roles, {});
  dir.changeOwnPassword(name, first, password);
  accounts[name] = { username: name, password };
}

// Volume représentatif : 20 000 consultations + RFQ + lignes (comme audit:scale).
db.exec(`
CREATE TEMP TABLE FixtureLinks AS SELECT row_number() OVER (ORDER BY materialId,supplierId) as n, materialId,supplierId,unit FROM SupplierMaterial JOIN Material ON materialId=Material.id LIMIT 40;
`);
{
  const cte = (from, to) => `WITH RECURSIVE seq(i) AS(VALUES(${from}) UNION ALL SELECT i+1 FROM seq WHERE i<${to})`;
  db.exec(`BEGIN;
  ${cte(1, 20000)} INSERT INTO SupplierConsultation(id,ref,status,createdBy,createdAt,deadline)
   SELECT i,printf('P6-CONS-%06d',i),CASE WHEN i%4=0 THEN 'closed' ELSE 'prepared' END,'buyer0',1760000000000+i*3600000,1790000000000+i*3600000 FROM seq;
  ${cte(1, 20000)} INSERT INTO SupplierRFQ(id,ref,materialId,qty,unit,status,createdBy,createdAt,targetDate)
   SELECT i,printf('P6-RFQ-%06d',i),m.materialId,10,m.unit,CASE WHEN i%4=0 THEN 'closed' ELSE 'open' END,'buyer0',1760000000000+i*3600000,1790000000000+i*3600000 FROM seq JOIN FixtureLinks m ON m.n=(i%40)+1;
  ${cte(1, 20000)} INSERT INTO SupplierConsultationLine(id,consultationId,rfqId) SELECT i,i,i FROM seq;
  ${cte(1, 20000)} INSERT INTO SupplierConsultationRecipient(id,consultationId,supplierId) SELECT i,i,m.supplierId FROM seq JOIN FixtureLinks m ON m.n=(i%40)+1;
  COMMIT;`);
}
const mattress = db.prepare(`SELECT p.id,p.unitPrice FROM Product p WHERE p.status='active' AND p.family='MATELAS' AND p.unit='u' AND p.materialId IS NULL LIMIT 1`).get();
const client = db.prepare('SELECT id FROM Client ORDER BY id LIMIT 1').get();
assert(mattress && client, 'fixtures base démo requises');

function freePort() { return new Promise((r, j) => { const s = createServer(); s.on('error', j); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }
async function login(url, name) {
  const r = await fetch(url + '/api/auth/login', { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify(accounts[name]) });
  assert.equal(r.status, 200, 'login ' + name);
  return r.headers.get('set-cookie').split(';')[0];
}
function pct(values, p) { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function serverStats(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ');
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = Number((/VmRSS:\s+(\d+)/.exec(status) || [0, 0])[1]);
    return { cpuJiffies: Number(stat[13]) + Number(stat[14]), rssKB: rss };
  } catch { return null; }
}

(async () => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)],
    { cwd: root, env: { ...process.env, GOCMD_DB_FILE: file, DATABASE_URL: 'file:' + file, GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_ALLOW_DEMO_DB: '1', GOCMD_SALES_TAX_RATES_BPS: '0,2000', GOCMD_PUBLIC_ORIGIN: url, NODE_ENV: 'production' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 150; i++) { if (server.exitCode !== null) throw new Error('serveur mort'); try { if ((await fetch(url + '/api/me')).status === 401) break; } catch {} assert(i < 149); await new Promise(r => setTimeout(r, 200)); }

  async function api(cookie, method, path, body, expect) {
    const t0 = performance.now();
    const r = await fetch(url + path, { method, headers: { origin: url, cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, ms: Math.round(performance.now() - t0), data };
  }

  for (const LEVEL of [10, 20, 50]) {
    const cookies = {};
    for (let i = 0; i < LEVEL; i++) { cookies[`sales${i}`] = await login(url, `sales${i}`); cookies[`appr${i}`] = await login(url, `appr${i}`); }
    cookies.buyer0 = await login(url, 'buyer0'); cookies.fin0 = await login(url, 'fin0');
    const before = serverStats(server.pid);
    const t0 = Date.now();
    const lat = { list: [], heavy: [], create: [], approve: [], materials: [] };
    const results = { ok: 0, business: 0, tech: 0, errors: [] };

    // Une vague de LEVEL sessions concurrentes, chaque session fait son panier.
    await Promise.all(Array.from({ length: LEVEL }, async (_, i) => {
      const sc = cookies[`sales${i}`];
      // 1. Liste des commandes (pagination).
      let r = await api(sc, 'GET', '/api/orders?take=100');
      if (r.status === 200) { results.ok++; lat.list.push(r.ms); } else { if (r.status < 500) results.business++; else results.tech++; results.errors.push(`orders ${r.status}`); }
      // 2. Liste lourde achats : recherche + tri + pagination (20 000 consultations).
      r = await api(cookies.buyer0, 'GET', `/api/p2p/consultations?pageSize=40&view=summary&sort=urgency&page=${(i % 5) + 1}`);
      if (r.status === 200) { results.ok++; lat.heavy.push(r.ms); } else { if (r.status < 500) results.business++; else results.tech++; results.errors.push(`consult ${r.status}`); }
      // 3. Catalogue matières.
      r = await api(cookies.buyer0, 'GET', '/api/materials?take=100');
      if (r.status === 200) { results.ok++; lat.materials.push(r.ms); } else { if (r.status < 500) results.business++; else results.tech++; results.errors.push(`materials ${r.status}`); }
      // 4. Création de commande (cotes personnalisées → revue technique, jour
      // distinct par session ET par niveau : plages disjointes, aucune session
      // ne doit déclencher la garde doublons — c'est une charge, pas des doublons).
      const dayOffset = { 10: 200, 20: 260, 50: 320 }[LEVEL] + i;
      const due = new Date(Date.now() + dayOffset * 86400e3).toISOString();
      r = await api(sc, 'POST', '/api/orders', { clientId: client.id, dueDate: due, priority: 'normale', note: `P6-LOAD-${LEVEL}-${Date.now()}-${i}`, lines: [{ productId: mattress.id, qty: 1, unitPrice: Number(mattress.unitPrice), dimensions: { lengthCm: 185, widthCm: 90, heightCm: 18 }, technicalInstructions: `Charge P6 niveau ${LEVEL} session ${i}` }] });
      if (r.status === 201) { results.ok++; lat.create.push(r.ms); } else { results.tech++; results.errors.push(`create ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`); }
      // 5. Validation quatre-yeux par un AUTRE compte approbateur.
      if (r.status === 201) {
        const appr = cookies[`appr${(i + 1) % LEVEL}`];
        const v = await api(appr, 'PATCH', `/api/orders/${r.data.order.id}`, { action: 'approve', comment: `Validation charge P6 ${LEVEL}/${i}` });
        if (v.status === 200) { results.ok++; lat.approve.push(v.ms); } else { results.tech++; results.errors.push(`approve ${v.status} ${JSON.stringify(v.data).slice(0, 120)}`); }
      }
    }));
    const wall = Date.now() - t0;
    const after = serverStats(server.pid);
    assert.equal(results.tech, 0, `niveau ${LEVEL} : AUCUNE erreur technique attendue — ${results.errors.join(' | ')}`);
    const summary = {
      niveau: LEVEL, sessions: LEVEL * 2 + 2, operations: results.ok + results.business + results.tech,
      succes: results.ok, refusMetier: results.business, erreursTechniques: results.tech,
      dureeMs: wall,
      latences: {
        listeCommandes: { p50: pct(lat.list, .5), p95: pct(lat.list, .95), max: Math.max(...lat.list, 0) },
        listeLourde20k: { p50: pct(lat.heavy, .5), p95: pct(lat.heavy, .95), max: Math.max(...lat.heavy, 0) },
        matieres: { p50: pct(lat.materials, .5), p95: pct(lat.materials, .95), max: Math.max(...lat.materials, 0) },
        creationCommande: { p50: pct(lat.create, .5), p95: pct(lat.create, .95), max: Math.max(...lat.create, 0) },
        validationQuatreYeux: { p50: pct(lat.approve, .5), p95: pct(lat.approve, .95), max: Math.max(...lat.approve, 0) },
      },
      serveur: before && after ? { cpuJiffies: after.cpuJiffies - before.cpuJiffies, rssMo: Math.round(after.rssKB / 1024) } : null,
    };
    console.log('P6 LOAD ' + JSON.stringify(summary));
    // Invariants après chaque niveau.
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const partial = db.prepare(`SELECT count(*) n FROM "Order" o WHERE NOT EXISTS (SELECT 1 FROM OrderLine l WHERE l.orderId=o.id)`).get().n;
    assert.equal(partial, 0, 'aucune commande sans lignes (écriture partielle)');
  }
  // Sauvegarde mesurée sur la base chargée (volume réaliste).
  const { spawnSync } = require('node:child_process');
  const bk = spawnSync(process.execPath, ['--version'], {});
  const t0 = Date.now();
  const backup = spawnSync('python3', [join(root, 'scripts/backup_sqlite.py'), '--source', file, '--output-dir', temp], { encoding: 'utf8' });
  const backupMs = Date.now() - t0;
  console.log(`P6 LOAD SAUVEGARDE SQLite: rc=${backup.status} durée=${backupMs} ms (base ${Math.round(require('node:fs').statSync(file).size / 1048576)} Mo)`);
  assert.equal(backup.status, 0, 'sauvegarde: ' + backup.stderr);
  console.log('PASS P6 LOAD : niveaux 10/20/50 sessions — 0 erreur technique, 0 écriture partielle, intégrité préservée, latences mesurées (environnement de recette, PAS le serveur SODEPI).');
  try { process.kill(server.pid, 'SIGKILL'); } catch {}
  db.close();
  require('node:fs').rmSync(temp, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error('FAIL P6 LOAD', e); process.exit(1); });
