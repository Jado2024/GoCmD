#!/usr/bin/env node
/* GoCmd P5.15.22 (CLT-04) — CONCURRENCE PRÉPARATION D'OF SUR STOCK FINI.
 * Scénario exigé par la clôture : deux OF demandant chacun QUATRE matelas
 * alors qu'il n'en existe que QUATRE en stock fini. Aucune double allocation,
 * aucune préparation déclarée disponible à tort.
 *
 * Phase A (un processus serveur) : les deux préparations partent SIMULTANÉMENT
 *   → exactement une 200 et une 409 ; le stock physique n'est pas débité par
 *   « préparer » ; la commande perdante ne peut pas avancer (OF en brouillon) ;
 *   après livraison des quatre matelas par la commande gagnante, la
 *   préparation du perdant reste refusée (stock réel épuisé).
 * Phase B (DEUX processus serveur, même base) : la course est rejouée à travers
 *   deux instances `next start` distinctes → le verrou d'écriture SQLite pris
 *   AVANT la lecture du stock (GOCMD_OF_PREPARE_LOCK) garantit de nouveau
 *   exactement une 200 / une 409, base intègre.
 *
 * Localhost uniquement ; base SQLite jetable copiée depuis db/custom.db.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createAccounts, loginAccounts } = require('./qa-managed-accounts.cjs');

const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-of-conc-'));
const testDB = path.join(dir, 'of-conc.db');
fs.copyFileSync(path.join(root, 'db', 'custom.db'), testDB);
if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) {
  console.error('Build de production absent : exécuter `bun run build` avant ce test.');
  process.exit(2);
}
const db = new DatabaseSync(testDB);

const SPEC = {
  SALES: ['sales'], SALES2: ['sales'], APPROVER: ['approver'],
  INVENTORY: ['inventory'], QUALITY: ['quality'],
};
const accounts = createAccounts(testDB, 'ofc', SPEC);

// Fixture dynamique : un matelas vendu à l'unité, sans matière liée (base démo).
// AUDIT P5.15.27-B (AN-CLT-04) : prix catalogue lu dynamiquement — la valeur
// en dur (235) correspondait à la base P5.15.21 ; après reseed P5.15.23 le
// matelas vaut 245 et un écart de prix basculait la commande en
// pending_validation (aucun OF, items[0] undefined). Le prix du jour fait
// partie de la fixture, comme le productId.
const matelas = db.prepare(`SELECT id, unitPrice FROM Product WHERE family='MATELAS' AND status='active' AND unit='u' AND materialId IS NULL ORDER BY id LIMIT 1`).get();
assert(matelas, 'fixture matelas requis (base démo)');
const client = db.prepare('SELECT id FROM Client ORDER BY id LIMIT 1').get();
assert(client, 'fixture client requis');

// AUDIT P5.15.27-B (AN-CLT-04) : depuis le durcissement SOURCE_NOT_APPROVED
// (« une sourceRef libre ne crée jamais du stock »), l'amorce des lots finis
// passe par le circuit MTS réel : DPR approuvée + OF de fabrication pour stock
// terminé. Semis AVANT le démarrage des serveurs (visibilité immédiate).
function seedDprLot(productId, qty, ref) {
  db.prepare(`INSERT INTO ProductionReplenishmentRequest(ref,productId,qty,unit,status,reason,createdBy) VALUES(?,?,?,?,?,?,?)`)
    .run(ref, productId, qty, 'u', 'approved', 'Recette CLT-04 : lot témoin de concurrence', 'ofc_inventory');
  const rid = db.prepare(`SELECT id FROM ProductionReplenishmentRequest WHERE ref=?`).get(ref).id;
  db.prepare(`INSERT INTO ProductionStockOrder(ref,requestId,status,createdBy,completedBy) VALUES(?,?,?,?,?)`)
    .run(ref.replace(/^DPR-/, 'OF-'), rid, 'completed', 'ofc_inventory', 'ofc_inventory');
  return ref;
}
seedDprLot(matelas.id, 4, 'DPR-CLT04-A');
seedDprLot(matelas.id, 4, 'DPR-CLT04-B');

const servers = [];
const sessions = [];
const origins = [];
let n = 0;

async function freePort() {
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  return port;
}

async function startServer() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: root,
    env: { ...process.env, GOCMD_DB_FILE: testDB, DATABASE_URL: 'file:' + testDB,
      GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_REQUIRE_RBAC: '1', GOCMD_ACCESS_PASSWORD: '',
      GOCMD_SALES_TAX_RATES_BPS: '0,2000', GOCMD_PUBLIC_ORIGIN: base, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(server);
  let output = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (x) => { output = (output + x).slice(-5000); });
  let ready = false;
  for (let i = 0; i < 160; i++) {
    assert(server.exitCode === null, `Serveur exit ${server.exitCode}: ${output}`);
    try { if ((await fetch(base + '/api/me', { signal: AbortSignal.timeout(1200) })).status === 401) { ready = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 350));
  }
  assert(ready, 'serveur non prêt');
  origins.push(base);
  sessions.push(await loginAccounts(base, accounts));
}

async function api(instance, role, method, urlPath, body, allowed = [200, 201]) {
  const response = await fetch(origins[instance] + urlPath, {
    method,
    headers: { origin: origins[instance], cookie: sessions[instance][role], 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  n++;
  if (!allowed.includes(response.status)) throw new Error(`${role} ${method} ${urlPath} ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return { status: response.status, data };
}


// P6 (2026-11-11) : quatre commandes DISTINCTES (jours de livraison différents),
// chacune avec son OF — la garde doublons P5.15.29-P5 ne doit pas les confondre
// avec des répétitions ; le sujet du test reste la course d'allocation du stock.
const orderFour = (day = 14) => ({ clientId: client.id, dueDate: new Date(Date.now() + day * 86400e3).toISOString(), priority: 'normale', lines: [{ productId: matelas.id, qty: 4, unitPrice: matelas.unitPrice }] });
const workOrderOf = async (instance, role, orderId) => (await api(instance, role, 'GET', `/api/work-orders?orderId=${orderId}`)).data.items[0];
const finishedQty = () => db.prepare("SELECT COALESCE(SUM(qty),0) q FROM FinishedStockLot WHERE productId=? AND status='available'").get(matelas.id).q;
const ofStatus = (woid) => db.prepare('SELECT status FROM WorkOrder WHERE id=?').get(woid).status;

async function receiveFour(tag) {
  // AUDIT P5.15.27-B (AN-CLT-04) : sourceRef = DPR du circuit MTS réel
  // (une réception libre resterait refusée, cf. SOURCE_NOT_APPROVED).
  const lot = (await api(0, 'INVENTORY', 'POST', '/api/sales/finished-stock', { action: 'receive', productId: matelas.id, lotCode: `OF-CONC-${tag}`, qty: 4, sourceRef: `DPR-CLT04-${tag}` }, [201])).data.lot;
  await api(0, 'QUALITY', 'POST', '/api/sales/finished-stock', { action: 'release', lotId: lot.id, reason: `Contrôle qualité conforme CLT-04 ${tag}` });
  return lot;
}

(async () => {
  await startServer();

  // ---------- Phase A : course simultanée sur un même processus ----------
// AUDIT P5.15.27-B (AN-CLT-04) : « prepare » est réservé au magasinier (garde RBAC).
  //
  await receiveFour('A');
  assert.equal(finishedQty(), 4, 'stock fini initial : quatre matelas disponibles');

  const orderA = (await api(0, 'SALES', 'POST', '/api/orders', orderFour(14))).data.order;
  const orderB = (await api(0, 'SALES2', 'POST', '/api/orders', orderFour(15))).data.order;
  // CASCADE3 (11/11/2026) — P1FIX : toute commande naît pending_validation et
  // ses OF n'existent qu'après le visa commercial quatre-yeux. Vérifié
  // négativement AVANT approbation, puis les deux commandes sont validées
  // par le responsable indépendant avant la course d'allocation.
  assert.equal((await api(0, 'SALES', 'GET', `/api/work-orders?orderId=${orderA.id}`)).data.items.length, 0,
    'aucun OF avant approbation (P1FIX)');
  for (const o of [orderA, orderB]) {
    await api(0, 'APPROVER', 'PATCH', `/api/orders/${o.id}`, { action: 'approve', comment: `Validation quatre-yeux CLT-04 — ${o.ref}` });
  }
  const wofA = await workOrderOf(0, 'SALES', orderA.id);
  const wofB = await workOrderOf(0, 'SALES2', orderB.id);
  assert.notEqual(wofA.id, wofB.id, 'deux OF distincts, un par ligne de commande');
  // AUDIT P5.15.27-B (AN-CLT-04) : depuis la règle §7 (aucune deuxième
  // approbation commerciale des OF, cf. sc01/AUD-A5), les OF d'une commande
  // confirmée naissent « approved ». L’ancien « draft » attendu ici datait
  // de P5.15.22 ; ce qui compte pour la concurrence, c’est que seul l’OF
  // gagnant passe « completed » — le perdant ne doit jamais être marqué prêt.
  assert.equal(ofStatus(wofA.id), 'approved');
  assert.equal(ofStatus(wofB.id), 'approved');

  const race = await Promise.all([
    api(0, 'INVENTORY', 'PATCH', `/api/work-orders/${wofA.id}`, { action: 'prepare' }, [200, 409]),
    api(0, 'INVENTORY', 'PATCH', `/api/work-orders/${wofB.id}`, { action: 'prepare' }, [200, 409]),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort((a, b) => a - b), [200, 409],
    'exactement une préparation aboutit : le stock de quatre matelas ne peut pas être promis deux fois');
  const winner = race[0].status === 200 ? wofA : wofB;
  const loser = race[0].status === 200 ? wofB : wofA;
  assert.equal(ofStatus(winner.id), 'completed', 'l’OF gagnant passe en terminé');
  assert.equal(ofStatus(loser.id), 'approved', 'l’OF perdant reste non préparé : aucune disponibilité mensongère');
  assert.equal(finishedQty(), 4, '« préparer » ne débite aucun stock physique');

  // Le perdant reste refusé en séquentiel : la quantité est engagée par l'OF gagnant.
  await api(0, 'INVENTORY', 'PATCH', `/api/work-orders/${loser.id}`, { action: 'prepare' }, [409]);
  assert.equal(ofStatus(loser.id), 'approved');
  // La commande perdante ne peut pas être déclarée prête : son OF n'est pas terminé.
  // AUDIT P5.15.27-B (AN-CLT-04) : depuis la règle §7, l'OF naît « approved » et
  // l'entrée en production est permise ; la protection se concentre sur « ready »
  // (WORK_ORDERS_NOT_COMPLETED) — sans OF terminé, aucune livraison possible.
  const loserOrder = loser === wofA ? orderA : orderB;
  await api(0, 'SALES', 'PATCH', `/api/orders/${loserOrder.id}`, { action: 'advance' });
  await api(0, 'SALES', 'PATCH', `/api/orders/${loserOrder.id}`, { action: 'advance' }, [409]);
  // Vérrou de sérialisation présent : les préparations REFUSÉES sont annulées
  // (rollback) avec leur transaction, donc le compteur ne trace que les
  // préparations abouties — ici exactement une (la gagnante de la course).
  const lock = db.prepare("SELECT value FROM SalesDocCounter WHERE id='GOCMD_OF_PREPARE_LOCK'").get();
  assert(lock && lock.value === 1, 'compteur de verrou GOCMD_OF_PREPARE_LOCK tracé pour la préparation aboutie');

  // Livraison des quatre matelas par la commande gagnante, puis le perdant reste bloqué.
  const winnerOrder = winner === wofA ? orderA : orderB;
  await api(0, 'SALES', 'PATCH', `/api/orders/${winnerOrder.id}`, { action: 'advance' });
  await api(0, 'SALES', 'PATCH', `/api/orders/${winnerOrder.id}`, { action: 'advance' });
  const bl = (await api(0, 'SALES', 'POST', '/api/sales', { action: 'delivery', orderId: winnerOrder.id, stockLines: [{ orderLineId: winnerOrder.lines[0].id, qty: 4 }], requestKey: randomUUID() }, [201])).data.delivery;
  assert.ok(/BLC-/.test(bl.ref), 'BL de quatre matelas émis');
  assert.equal(finishedQty(), 0, 'stock fini épuisé après livraison réelle');
  await api(0, 'INVENTORY', 'PATCH', `/api/work-orders/${loser.id}`, { action: 'prepare' }, [409]);
  assert.equal(ofStatus(loser.id), 'approved', 'aucune préparation déclarée disponible après épuisement du stock');
  console.log('PASS phase A (un processus) : deux OF × 4 matelas sur 4 en stock → une 200, une 409, aucun faux disponible');

  // ---------- Phase B : course simultanée à travers DEUX processus ----------
  await startServer();
  await receiveFour('B');
  assert.equal(finishedQty(), 4, 'complément de stock fini : quatre matelas disponibles');

  const orderC = (await api(0, 'SALES', 'POST', '/api/orders', orderFour(16))).data.order;
  const orderD = (await api(1, 'SALES2', 'POST', '/api/orders', orderFour(17))).data.order;
  // CASCADE3 (11/11/2026) — P1FIX : idem phase A — les OF n'existent qu'après
  // le visa commercial quatre-yeux, quel que soit le processus serveur.
  for (const o of [orderC, orderD]) {
    await api(0, 'APPROVER', 'PATCH', `/api/orders/${o.id}`, { action: 'approve', comment: `Validation quatre-yeux CLT-04 phase B — ${o.ref}` });
  }
  const wofC = await workOrderOf(0, 'SALES', orderC.id);
  const wofD = await workOrderOf(1, 'SALES2', orderD.id);

  const raceB = await Promise.all([
    api(0, 'INVENTORY', 'PATCH', `/api/work-orders/${wofC.id}`, { action: 'prepare' }, [200, 409]),
    api(1, 'INVENTORY', 'PATCH', `/api/work-orders/${wofD.id}`, { action: 'prepare' }, [200, 409]),
  ]);
  assert.deepEqual(raceB.map((r) => r.status).sort((a, b) => a - b), [200, 409],
    'deux processus distincts : exactement une préparation aboutit malgré la course');
  const completedB = db.prepare("SELECT COUNT(*) n FROM WorkOrder WHERE id IN (?,?) AND status='completed'").get(wofC.id, wofD.id).n;
  assert.equal(completedB, 1, 'un seul OF terminé après la course multi-processus');
  const lockB = db.prepare("SELECT value FROM SalesDocCounter WHERE id='GOCMD_OF_PREPARE_LOCK'").get();
  assert(lockB && lockB.value === 2, 'deux préparations abouties au total (une par phase), verrou persistant');
  assert.equal(finishedQty(), 4, 'stock physique intact : aucune double allocation');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS phase B (deux processus) : verrou SQLite GOCMD_OF_PREPARE_LOCK → une 200, une 409, base intègre');

  console.log(`PASS CLT-04 : ${n} requêtes HTTP — deux OF simultanés de 4 matelas sur 4 en stock, zéro double allocation, zéro préparation mensongère — base jetable ${testDB}`);
})().catch((e) => { console.error('FAIL CLT-04 :', e.message); process.exitCode = 1; })
  .finally(async () => {
    for (const server of servers) {
      if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]); if (server.exitCode === null) server.kill('SIGKILL'); }
    }
    db.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
