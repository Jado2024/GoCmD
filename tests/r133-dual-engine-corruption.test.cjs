#!/usr/bin/env node
/* R13.3 CORR-01 — non-régression de l'intégrité SQLite sous écritures concurrentes.
 *
 * Défaut corrigé (démontré sur R13.2) : dans le processus serveur Next.js, les
 * écritures node:sqlite (sessions au login, audits de confirmation sensible)
 * et les écritures Prisma (commandes) ne se verrouillent pas entre elles — les
 * verrous POSIX sont détenus par PROCESSUS. Un login concurrent d'une création
 * de commande entrelaçait les pages et corrompait la base (indexes GoCmdSession
 * et OrderLine détruits ; preuves : bases/EVIDENCE_corruption_*.db de la
 * campagne R13.3, intégrité détruite en phase « Prisma + logins »).
 *
 * Correctif : GOCMD_SERVER_RUNTIME=1 (posé par next.config.ts et le starter
 * vérifié) rend la connexion node:sqlite de user-directory.cjs STRICTEMENT
 * lecture seule ; les écritures identités passent par le client Prisma unique
 * (src/lib/identity-writes.ts) via la file serializedSQLiteWrite.
 *
 * Ce test rejoue la charge corruptrice : écritures métier concurrentes +
 * logins + confirmations sensibles, avec contrôle d'intégrité à chaque phase.
 * Il ne passe que si l'intégrité reste OK (sur R13.2 non corrigé, la phase 2
 * détruisait la base).
 *
 * Usage : GOCMD_E2E_CONFIRM=ISOLATED_DB_ONLY node tests/r133-dual-engine-corruption.test.cjs
 * Uniquement localhost + copie jetable de la base démo ; jamais une base réelle.
 */
'use strict';
if (process.env.GOCMD_E2E_CONFIRM !== 'ISOLATED_DB_ONLY') throw Error('REFUSED: use isolated DB only');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { copyFileSync, appendFileSync, readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { createServer } = require('node:net');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = resolve(__dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'gocmd-r133-corr01-'));
const file = join(temp, 'corr.db');
copyFileSync(join(root, 'db', 'custom.db'), file);
process.env.GOCMD_DB_FILE = file;
const { DatabaseSync } = require('node:sqlite');
const dir = require(join(root, 'src/lib/user-directory.cjs'));
const udb = new DatabaseSync(file);
const admin = udb.prepare('SELECT username FROM GoCmdUser WHERE is_root=1').get().username;
const accounts = {};
for (const [name, roles] of Object.entries({ sales0: ['sales'], appr0: ['approver'], dir0: ['director'] })) {
  const first = randomBytes(24).toString('base64url'), pw = randomBytes(24).toString('base64url');
  dir.createUser(admin, name, first, roles, {});
  dir.changeOwnPassword(name, first, pw);
  accounts[name] = { username: name, password: pw };
}
udb.close();

function integrity(label) {
  // Contrôle en lecture seule ; une base corrompue échoue ici.
  const r = spawnSync(process.execPath, ['-e',
    `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(file)},{readOnly:true});
     const rows=db.prepare('PRAGMA integrity_check').all();
     if(rows[0].integrity_check!=='ok'){console.error(rows.slice(0,3).map(x=>x.integrity_check).join(' | '));process.exit(1)}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, `intégrité ${label} : ${(r.stdout || r.stderr || '').slice(0, 300)}`);
}

function freePort() { return new Promise((r, j) => { const s = createServer(); s.on('error', j); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let server = null;
(async () => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const serverLog = join(temp, 'server.log');
  server = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: root, env: { ...process.env, HOSTNAME: '127.0.0.1', DATABASE_URL: 'file:' + file, GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_ALLOW_DEMO_DB: '1', GOCMD_SERVER_RUNTIME: '1', GOCMD_REQUIRE_OF_FOR_PRODUCTION: '1', GOCMD_SALES_TAX_RATES_BPS: '0,2000', GOCMD_PUBLIC_ORIGIN: url, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', d => appendFileSync(serverLog, d));
  server.stderr.on('data', d => appendFileSync(serverLog, d));
  for (let i = 0; i < 200; i++) { if (server.exitCode !== null) throw Error('serveur mort — voir ' + serverLog); try { if ((await fetch(url + '/api/me')).status === 401) break; } catch {} assert(i < 199); await sleep(250); }

  // Contention transitoire (R13.2/P5.15.28 P1) : la base tourne en journal
  // DELETE — règle métier validée — et sous les tempêtes d'écritories
  // délibérées de ce test, l'API peut répondre 503 + Retry-After (comportement
  // CONÇU, documenté par test:r132:contracts). Ce n'est ni corruption ni
  // anomalie d'écriture : le harnais réessaie donc borné (8 essais, budget
  // Retry-After respecté) et COMPTE les contentions absorbées pour la
  // transparence. Un 503 qui persiste au-delà du budget échoue le test.
  let contentionsAbsorbees = 0;
  const retryTransient = async (doFetch, label) => {
    for (let attempt = 1; ; attempt++) {
      const r = await doFetch();
      if (r.status === 503 && attempt < 8) {
        contentionsAbsorbees++;
        const ra = Math.min(Number(r.headers.get('retry-after') || 0.25) * 1000, 2000);
        await sleep(ra);
        continue;
      }
      if (r.status === 503) assert.fail(`${label} : 503 persistant au-delà de 8 essais (contention non transitoire)`);
      return r;
    }
  };
  const login = async (name) => {
    const r = await retryTransient(() => fetch(url + '/api/auth/login', { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify(accounts[name]) }), 'login ' + name);
    assert.equal(r.status, 200, 'login ' + name);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const cookie = {};
  for (const n of ['sales0', 'appr0', 'dir0']) cookie[n] = await login(n);
  const api = async (user, method, path, body) => {
    const r = await fetch(url + path, { method, headers: { origin: url, cookie: cookie[user], 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let d = null; try { d = await r.json(); } catch {}
    return { status: r.status, d };
  };
  // Les confirmations sensibles s'exécutent sous charge d'écriture concurrente :
  // même traitement borné de la contention transitoire (503 + Retry-After).
  const apiTransient = async (user, method, path, body) => {
    const r = await retryTransient(() => fetch(url + path, { method, headers: { origin: url, cookie: cookie[user], 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), `${method} ${path}`);
    let d = null; try { d = await r.json(); } catch {}
    return { status: r.status, d };
  };
  const client = (await api('sales0', 'GET', '/api/clients?take=5')).d.items[0];
  assert(client, 'client démo requis');
  let mattress = null;
  for (let page = 1; page <= 10 && !mattress; page++) {
    const pr = await api('sales0', 'GET', `/api/products?page=${page}`);
    if (!pr.d?.items?.length) break;
    mattress = pr.d.items.find(p => p.family === 'MATELAS' && p.status === 'active' && p.unit === 'u' && !p.isOrderScoped);
  }
  assert(mattress, 'matelas actif requis');
  let seq = 0;
  const create = async () => {
    const body = { clientId: client.id, dueDate: new Date(Date.now() + (1 + seq % 200) * 86400_000).toISOString(), priority: 'normale', note: `CORR01-${seq}`, lines: [{ productId: mattress.id, qty: 1 + (seq % 40), unitPrice: mattress.unitPrice }] };
    seq++;
    let r = await api('sales0', 'POST', '/api/orders', body);
    if (r.status === 409 && r.d?.token) { body.duplicateReview = { token: r.d.token, reason: 'Test non-régression CORR-01 : commande de test confirmée' }; r = await api('sales0', 'POST', '/api/orders', body); }
    return r.status;
  };

  // Phase 1 — écritures métier Prisma seules : intégrité attendue OK.
  const N = 40;
  const r1 = await Promise.all(Array.from({ length: N }, () => create()));
  const statuses1 = r1.reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {});
  assert(r1.filter(s => s === 201).length >= N * 0.9, `créations phase 1 : statuts ${JSON.stringify(statuses1)} (serveur : ${readFileSync(serverLog, 'utf8').slice(-600)})`);
  integrity('phase1-ecritures-seules');

  // Phase 2 — créations + LOGINS concurrents : vérifier que les deux types
  // d'écritures ont VRAIMENT été exercés, pas simplement l'intégrité d'une DB vide.
  const work = [];
  for (let i = 0; i < N; i++) { work.push(create()); work.push(login('sales0')); work.push(login('appr0')); }
  const results2 = await Promise.all(work);
  const created2 = results2.filter(x => x === 201).length;
  const logins2 = results2.filter(x => typeof x === 'string' && x.includes('gocmd_session=')).length;
  // Les logins validés ont généré un cookie ; les écritures sales sont
  // contrôlées par la même assertion de succès et par les comptes en SQLite.
  assert(created2 >= N / 2, `phase2 : seulement ${created2}/${N} créations HTTP 201 ; charge non qualifiée`);
  assert(logins2 === N * 2, `phase2 : seulement ${logins2}/${N * 2} logins avec cookie ; charge non qualifiée`);
  integrity('phase2-logins-concurrents');

  // Phase 3 — vrais visas directeur sur commandes prix hors catalogue.
  // Ne pas utiliser GEN-MAT/MOU/DIV (D-GEN-01 ouvert) ni un gabarit générique
  // optionnel : une fixture qui ne crée aucune commande ne prouve RIEN.
  const priceBase = Number(mattress.unitPrice);
  assert(Number.isFinite(priceBase) && priceBase >= 0, 'prix catalogue matelas non utilisable');
  const specialPrice = Number((priceBase + 15.5).toFixed(2));
  const pending = [];
  for (let i = 0; i < 4; i++) {
    const r = await api('sales0', 'POST', '/api/orders', {
      clientId: client.id,
      dueDate: new Date(Date.now() + (160 + i) * 86400_000).toISOString(),
      priority: 'normale', note: `CORR01-VISA-${i}`,
      lines: [{ productId: mattress.id, qty: i + 1, unitPrice: specialPrice }],
    });
    assert.equal(r.status, 201, `phase3 : commande prix exceptionnel ${i} refusée HTTP ${r.status} ${JSON.stringify(r.d).slice(0,250)}`);
    assert(r.d?.order?.id, 'phase3 : commande réellement créée obligatoire');
    const line = r.d.order.lines?.[0];
    assert(line?.id && line.priceApprovalStatus === 'pending', 'phase3 : ligne réellement soumise au visa directeur');
    pending.push({ orderId: r.d.order.id, lineId: line.id });
  }
  assert.equal(pending.length, 4, 'phase3 : quatre commandes en attente obligatoires');

  // Les visas sensibles s'exécutent sous charge d'écriture métier et login.
  // Chaque approbation quatre-yeux intervient APRÈS le visa directeur de sa
  // propre ligne (pas en parallèle, ce qui serait un 409 métier attendu).
  const approvals = pending.map(async ({ orderId, lineId }) => {
    const price = await apiTransient('dir0', 'PATCH', `/api/orders/${orderId}`, {
      action: 'approve-prices', lineId, reason: 'Visa prix de la recette anticorruption',
      sensitivePassword: accounts.dir0.password,
    });
    assert.equal(price.status, 200, `phase3 : visa directeur ${orderId}: HTTP ${price.status}`);
    const order = await apiTransient('appr0', 'PATCH', `/api/orders/${orderId}`, {
      action: 'approve', comment: 'Validation indépendante CORR-01',
    });
    assert.equal(order.status, 200, `phase3 : approbation quatre yeux ${orderId}: HTTP ${order.status}`);
    return { orderId, status: order.status };
  });
  const competingWrites = Array.from({ length: 8 }, () => create());
  const competingLogins = Array.from({ length: 8 }, () => login('sales0'));
  const [approvalsDone, writesDone, loginsDone] = await Promise.all([
    Promise.all(approvals), Promise.all(competingWrites), Promise.all(competingLogins),
  ]);
  assert.equal(approvalsDone.length, pending.length, 'phase3 : aucune approbation réelle manquante');
  assert(writesDone.some(status => status === 201), 'phase3 : aucune écriture métier concurrente n’a abouti');
  assert.equal(loginsDone.length, 8, 'phase3 : aucune concurrence session/Prisma');
  integrity('phase3-confirmations-sensibles');

  // Phase 4 — rafales répétées : la corruption R13.2 était cumulative.
  for (let round = 0; round < 3; round++) {
    const burst = [];
    for (let i = 0; i < 12; i++) { burst.push(create()); burst.push(login('sales0')); }
    const burstResults = await Promise.all(burst);
    assert(burstResults.some(status => status === 201), `phase4-${round} : aucune écriture métier réussie`);
    integrity(`phase4-rafale-${round}`);
  }

  server.kill('SIGTERM');
  await sleep(1200);
  try { server.kill('SIGKILL'); } catch {}
  integrity('apres-arret');
  rmSync(temp, { recursive: true, force: true });
  console.log(`PASS R13.3 CORR-01 : intégrité SQLite maintenue sous écritures métier, logins et confirmations sensibles concurrents (topologie mono-processus, 4 phases + arrêt ; contentions 503 transitoires absorbées par réessai borné : ${contentionsAbsorbees}).`);
})().catch(e => { console.error('FAIL R13.3 CORR-01 :', e.message); try { server?.kill('SIGKILL'); } catch {} try { rmSync(temp, { recursive: true, force: true }); } catch {} process.exit(1); });
