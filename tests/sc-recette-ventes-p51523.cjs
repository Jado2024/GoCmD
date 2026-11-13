#!/usr/bin/env node
/* GoCmd P5.15.23 — RECETTE MÉTIER COMPLÉMENTAIRE (SC-13..SC-15).
 * Mission d'homologation du 08/11/2026 : scénarios supplémentaires exigés.
 * Exécution réelle sur serveur de production local et base SQLite jetable.
 * Localhost uniquement ; aucune écriture sur db/custom.db (copie temporaire).
 *
 * SC-13 modification d'une CMD après génération des OF → aucune voie de
 *      modification des lignes ; snapshots figés ; suspension/reprise cohérentes.
 * SC-14 préparation d'un OF puis mouvement concurrent de stock avant livraison
 *      → réservations protégées, quantités libres seules consommables.
 * SC-15 fermeture brutale, redémarrage et reprise après interruption →
 *      intégrité, réservations persistées, livraison reprise sans doublon.
 */
'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createAccounts } = require('./qa-managed-accounts.cjs');
process.env.GOCMD_E2E_CONFIRM = 'ISOLATED_DB_ONLY';
const fetchAuth = require('./qa-authenticated-fetch.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-sc-ventes-23-'));
const testDB = path.join(dir, 'sc23.db');
fs.copyFileSync(path.join(root, 'db', 'custom.db'), testDB);
const db = new DatabaseSync(testDB);

const SPEC = {
  // Un approbateur SEUL doit valider les OF (sans le rôle commercial).
  SALES: ['sales'], SALES2: ['sales'], SALES_APPROVER: ['approver'],
  DIRECTOR: ['director'], FINANCE: ['finance'], INVENTORY: ['inventory'], QUALITY: ['quality'],
};
const accounts = createAccounts(testDB, 's23', SPEC);
const env = { GOCMD_E2E_CONFIRM: 'ISOLATED_DB_ONLY' };
for (const name of Object.keys(SPEC)) {
  env[`GOCMD_E2E_${name}_NAME`] = accounts[name].username;
  env[`GOCMD_E2E_${name}_PASSWORD`] = accounts[name].password;
}
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}
let url; let n = 0;
async function call(role, method, pathName, data, allowed = [200, 201]) {
  const [name, password] = accounts[role] ? [accounts[role].username, accounts[role].password] : [null, null];
  const r = await fetchAuth(new URL(pathName, url), {
    method,
    headers: name ? { Authorization: 'Basic ' + Buffer.from(name + ':' + password).toString('base64'), 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
  const json = await r.json().catch(() => ({})); n++;
  if (!allowed.includes(r.status)) throw new Error(`${method} ${pathName} ${r.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return { status: r.status, ...json };
}
const due = (days = 14) => new Date(Date.now() + days * 86400e3).toISOString();
const order = (lines, extra = {}) => ({ clientId: 1, dueDate: due(), priority: 'normale', lines, ...extra });

const fixture = (sql, ...args) => db.prepare(sql).get(...args);
const matelas = fixture(`SELECT id,unitPrice FROM Product WHERE family='MATELAS' AND status='active' AND unit='u' AND materialId IS NULL ORDER BY id LIMIT 1`);
const bloc = fixture(`SELECT p.id, p.unitPrice, m.id materialId, m.stockQty stock FROM Product p JOIN Material m ON m.id=p.materialId WHERE p.status='active' AND m.isSellable=1 AND p.unit='bloc' AND m.stockQty>10 ORDER BY m.stockQty DESC, p.id LIMIT 1`);
assert(matelas && bloc, 'fixtures démo requis (matelas, négoce bloc)');

// AUDIT P5.15.27-B (AN-SC-14/15) : depuis le durcissement SOURCE_NOT_APPROVED
// (« une sourceRef libre ne crée jamais du stock »), l'amorce des lots finis
// passe par le circuit MTS réel : DPR approuvée + OF de fabrication pour stock
// terminé. Semis AVANT le démarrage du serveur (visibilité immédiate).
function seedDprLot(productId, qty, ref) {
  db.prepare(`INSERT INTO ProductionReplenishmentRequest(ref,productId,qty,unit,status,reason,createdBy) VALUES(?,?,?,?,?,?,?)`)
    .run(ref, productId, qty, 'u', 'approved', 'Recette SC : constitution du lot témoin', 's23_inventory');
  const rid = db.prepare(`SELECT id FROM ProductionReplenishmentRequest WHERE ref=?`).get(ref).id;
  db.prepare(`INSERT INTO ProductionStockOrder(ref,requestId,status,createdBy,completedBy) VALUES(?,?,?,?,?)`)
    .run(ref.replace(/^DPR-/, 'OF-'), rid, 'completed', 's23_inventory', 's23_inventory');
  return ref;
}
const DPR_SC14_A = seedDprLot(matelas.id, 4, 'DPR-SC14-LOT-A');
const DPR_SC15_A = seedDprLot(matelas.id, 2, 'DPR-SC15-LOT-A');

// P6U-P2FIX : une commande ne produit aucun OF avant l'approbation du responsable.
// Les tests positifs conservent le comportement métier, sans auto-validation.
async function createApprovedOrder(role, payload) {
  let created=await call(role, 'POST', '/api/orders', payload, [200,201,409]);
  if (created.status===409 && created.code==='DUPLICATE_ORDER_POTENTIAL' && created.token) {
    created=await call(role, 'POST', '/api/orders', {...payload,duplicateReview:{token:created.token,reason:'Nouvelle commande indépendante validée pour recette SODEPI P6U'}});
  }
  assert.equal(created.status,201,'création de commande distincte');
  assert.equal(created.order.status,'pending_validation','aucune commande créée ne contourne le contrôle quatre yeux');
  assert.equal((await workOrders(created.order.id)).length,0,'aucun OF avant approbation');
  const approved=await call('SALES_APPROVER','PATCH',`/api/orders/${created.order.id}`,{
    action:'approve',comment:'Approbation indépendante SODEPI P6U pour recette technique'
  });
  assert.notEqual(approved.order.status,'pending_validation');
  return {...created,order:approved.order};
}
async function workOrders(orderId) { return (await call('SALES', 'GET', `/api/work-orders?orderId=${orderId}`)).items; }
async function driveOf(woid, actions) { for (const a of actions) await call(['prepare','start','complete'].includes(a)?'INVENTORY':'SALES_APPROVER', 'PATCH', `/api/work-orders/${woid}`, { action: a }); }
const materialStock = (id) => db.prepare('SELECT stockQty FROM Material WHERE id=?').get(id).stockQty;
const auditActions = (entity, entityId) => db.prepare('SELECT action FROM AuditEvent WHERE entity=? AND entityId=? ORDER BY id').all(String(entity), String(entityId)).map(r => r.action);

const results = [];
async function check(id, title, fn) {
  try { await fn(); results.push({ id, title, result: 'PASS' }); console.log(`PASS ${id} : ${title}`); }
  catch (e) { results.push({ id, title, result: 'FAIL', detail: e.message }); console.error(`FAIL ${id} : ${title}\n  → ${e.message}`); }
}

// ---------------- SC-13 : modification d'une CMD après génération des OF ----------------
async function sc13() {
  const stockBefore = materialStock(bloc.materialId);
  const o = (await createApprovedOrder('SALES', order([{ productId: bloc.id, qty: 5, unitPrice: bloc.unitPrice }]))).order;
  const wos = await workOrders(o.id);
  assert.equal(wos.length, 1, 'un OF généré automatiquement');
  const snapshotBefore = wos[0].snapshot;
  const lineQtyBefore = db.prepare('SELECT qty FROM OrderLine WHERE id=?').get(o.lines[0].id).qty;
  // Préparation et réservation ferme AVANT la tentative de modification/suspension.
  // AUDIT P5.15.27-B (AN-SC-13, cf. RR-06) : depuis RR-06, la préparation d'un
  // OF de revente réserve les lots réels dans la transaction. L'appel manuel
  // reserve-stock est désormais redondant et refusé (409) : la réservation
  // ferme est créée par la préparation elle-même.
  await driveOf(wos[0].id, ['prepare']);
  assert.equal((await workOrders(o.id))[0].status, 'completed', 'OF de préparation terminé');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM SalesStockReservation WHERE orderLineId=?').get(o.lines[0].id).c, 1, 'réservation négoce active (créée par la préparation, RR-06)');

  // Aucune action de modification des lignes n'existe : tentatives refusées proprement.
  // (La porte de permission 403 se déclenche avant le rejet de schéma 400 : défense en profondeur.)
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'update', lines: [{ productId: bloc.id, qty: 99, unitPrice: 1 }] }, [400, 403]);
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'modify', qty: 99 }, [400, 403]);
  // Le corps « lines » est ignoré pour les actions connues : la quantité reste figée.
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'hold', reason: 'SC-13 suspension testée', lines: [{ qty: 99 }] });
  const afterHold = db.prepare('SELECT qty FROM OrderLine WHERE id=?').get(o.lines[0].id).qty;
  assert.equal(afterHold, lineQtyBefore, 'quantité de ligne inchangée après tentative de modification');
  // Règle SODEPI P5.15.23 : suspendre remet les OF de préparation en brouillon
  // et libère les réservations ; après reprise, une nouvelle préparation est requise.
  const held = (await workOrders(o.id))[0];
  // Audit 10/11/2026 (DEF-SC13) : le retour en « draft » exigerait une
  // RÉ-APPROBATION commerciale de l'OF après reprise, contraire à la règle
  // SODEPI §7 (« aucune deuxième approbation commerciale des OF »). Le code
  // remet l'OF de préparation en « approved » SANS marque de préparation et
  // libère les réservations : une nouvelle préparation magasinier reste
  // obligatoire avant toute livraison. C'est ce comportement protecteur
  // (cohérent avec §7) qui est vérifié ici.
  assert.equal(held.status, 'approved', 'OF de préparation désactivé par la suspension (statut approved, pas de 2e approbation)');
  assert.equal(held.preparationKind, null, 'marque de préparation libérée');
  assert.equal(held.completedBy, null, 'préparateur effacé');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM SalesStockReservation WHERE orderLineId=?').get(o.lines[0].id).c, 0, 'réservation libérée par la suspension');
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'resume', reason: 'SC-13 reprise' });

  // Les photographies OF restent figées (aucune réécriture rétroactive).
  const wosAfter = await workOrders(o.id);
  assert.deepEqual(wosAfter[0].snapshot, snapshotBefore, 'photographie OF inchangée après suspension/reprise');

  // Nouvelle commande = nouveau document ; la première n'est pas réécrite.
  const o2 = (await createApprovedOrder('SALES', order([{ productId: bloc.id, qty: 2, unitPrice: bloc.unitPrice }]))).order;
  assert.notEqual(o2.ref, o.ref, 'références CMD distinctes');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM "Order" WHERE ref=?').get(o.ref).c, 1, 'référence CMD unique en base');

  // Livraison de la première commande : le stock reflète exactement la ligne d'origine.
  await driveOf((await workOrders(o.id))[0].id, ['prepare']); // re-préparation magasinier après reprise (pas de 2e approbation, règle §7)
  await driveOf((await workOrders(o2.id))[0].id, ['prepare']);
  const d = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, stockLines: [{ orderLineId: o.lines[0].id, qty: 5 }], requestKey: randomUUID() })).delivery;
  assert.ok(/BLC-/.test(d.ref));
  assert.equal(materialStock(bloc.materialId), stockBefore - 5, 'stock décrémenté de la quantité CMD d’origine (5)');
  const events = auditActions('Order', o.id);
  for (const expected of ['CUSTOMER_ORDER_HOLD', 'CUSTOMER_ORDER_RESUME']) assert.ok(events.includes(expected), `audit ${expected} présent`);
}

// ---------------- SC-14 : préparation d'OF puis mouvement concurrent de stock ----------------
async function sc14() {
  // Partie A — négoce : réservation ferme, mouvement concurrent sur le même lot.
  const stockBefore = materialStock(bloc.materialId);
  const lot = db.prepare(`SELECT id, qty FROM StockLot WHERE materialId=? AND status='available' ORDER BY expiresAt IS NULL, expiresAt, id LIMIT 1`).get(bloc.materialId);
  assert(lot, 'lot disponible requis');
  const a = (await createApprovedOrder('SALES', order([{ productId: bloc.id, qty: 3, unitPrice: bloc.unitPrice }]))).order;
  // AUDIT P5.15.27-B (AN-SC-14, cf. RR-06) : la préparation réserve déjà les
  // lots réels ; l'appel manuel reserve-stock est redondant et refusé (409).
  await driveOf((await workOrders(a.id))[0].id, ['prepare']);
  const reservation = db.prepare('SELECT stockLotId, qty FROM SalesStockReservation WHERE orderLineId=?').get(a.lines[0].id);
  assert.equal(reservation.qty, 3, 'réservation négoce de 3 blocs créée par la préparation (RR-06)');

  // Mouvement concurrent interdit : consommer le lot entier violerait la réservation.
  await call('INVENTORY', 'POST', '/api/movements', { type: 'out', materialId: bloc.materialId, stockLotId: lot.id, qty: lot.qty, reason: 'SC-14 sortie concurrente totale' }, [409]);
  // Mouvement concurrent légitime : la part libre du lot reste consommable.
  // AUDIT P5.15.27-B (AN-SC-14) : depuis RR-06, la préparation laisse des
  // réservations actives — y compris celle du reliquat SC-13 non livré (o2).
  // La part libre se mesure donc sur les réservations ACTIVES du lot,
  // pas sur la seule quantité du présent scénario.
  const reservedOnLot = db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM SalesStockReservation WHERE stockLotId=?`).get(lot.id).q;
  const free = Math.max(0, Math.round((lot.qty - reservedOnLot) * 1000) / 1000);
  if (free >= 1) {
    await call('INVENTORY', 'POST', '/api/movements', { type: 'out', materialId: bloc.materialId, stockLotId: lot.id, qty: free, reason: 'SC-14 sortie concurrente part libre' });
  }
  // La livraison réservée réussit malgré le mouvement concurrent.
  const da = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: a.id, stockLines: [{ orderLineId: a.lines[0].id, qty: 3 }], requestKey: randomUUID() })).delivery;
  assert.ok(/BLC-/.test(da.ref), 'livraison de la commande réservée aboutit');
  assert.equal(materialStock(bloc.materialId), stockBefore - 3 - free, 'stock exact après sortie concurrente + livraison réservée');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM SalesStockReservation WHERE orderLineId=?').get(a.lines[0].id).c, 0, 'réservation libérée après livraison');
  assert.ok(materialStock(bloc.materialId) >= 0, 'stock jamais négatif');

  // Partie B — matelas finis : préparation (réservation FEFO) puis concurrence.
  // AUDIT P5.15.27-B (AN-SC-14) : amorce par circuit MTS réel (voir seedDprLot).
  const lot1 = (await call('INVENTORY', 'POST', '/api/sales/finished-stock', { action: 'receive', productId: matelas.id, lotCode: 'SC14-LOT-A', qty: 4, sourceRef: DPR_SC14_A })).lot;
  assert.ok(lot1, 'réception du lot témoin via DPR');
  await call('QUALITY', 'POST', '/api/sales/finished-stock', { action: 'release', lotId: lot1.id, reason: 'Contrôle qualité conforme SC-14' });
  const b = (await createApprovedOrder('SALES', order([{ productId: matelas.id, qty: 4, unitPrice: matelas.unitPrice }]))).order;
  await driveOf((await workOrders(b.id))[0].id, ['prepare']); // réserve les 4 matelas, stock inchangé
  await call('SALES', 'PATCH', `/api/orders/${b.id}`, { action: 'advance' });
  await call('SALES', 'PATCH', `/api/orders/${b.id}`, { action: 'advance' });
  const finRes = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(qty),0) q FROM FinishedStockReservation WHERE orderLineId=?').get(b.lines[0].id);
  assert.equal(finRes.c >= 1 && finRes.q, 4, 'quatre matelas réservés par lots');
  assert.equal(db.prepare('SELECT qty FROM FinishedStockLot WHERE id=?').get(lot1.id).qty, 4, 'la réservation ne débite pas le stock fini');

  // Commande concurrente C : la préparation doit échouer (aucune quantité libre).
  // P6 (2026-11-11) : C est une commande DISTINCTE (autre commercial, autre
  // jour de livraison) qui convoite le même stock — la garde doublons P5 ne
  // doit pas la confondre avec une répétition de B.
  const c = (await createApprovedOrder('SALES2', order([{ productId: matelas.id, qty: 4, unitPrice: matelas.unitPrice }], { dueDate: due(15) }))).order;
  // Audit 10/11/2026 (DEF-SC14) : la préparation concurrente doit être tentée
  // par le magasinier (rôle habilité) — sinon le refus 403 « rôle » masque la
  // garde de stock attendue (409) et le test n'exerce plus la protection.
  {const r=await call('SALES_APPROVER', 'PATCH', `/api/work-orders/${(await workOrders(c.id))[0].id}`, { action: 'prepare' }, [403]);
   assert.equal(r.status, 403, 'rôle non-magasinier refusé (garde RBAC)');}
  await call('INVENTORY', 'PATCH', `/api/work-orders/${(await workOrders(c.id))[0].id}`, { action: 'prepare' }, [409]);
  // La livraison non réservée de C ne peut pas prélever les matelas réservés de B.
  await driveOf((await workOrders(c.id))[0].id, ['start', 'complete']);
  await call('SALES2', 'PATCH', `/api/orders/${c.id}`, { action: 'advance' });
  await call('SALES2', 'PATCH', `/api/orders/${c.id}`, { action: 'advance' });
  await call('SALES2', 'POST', '/api/sales', { action: 'delivery', orderId: c.id, stockLines: [{ orderLineId: c.lines[0].id, qty: 4 }], requestKey: randomUUID() }, [409]);
  // B livre ses quatre matelas réservés : débit unique et exact.
  const dbLiv = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: b.id, stockLines: [{ orderLineId: b.lines[0].id, qty: 4 }], requestKey: randomUUID() })).delivery;
  assert.ok(/BLC-/.test(dbLiv.ref));
  assert.equal(db.prepare('SELECT qty FROM FinishedStockLot WHERE id=?').get(lot1.id).qty, 0, 'lot fini épuisé par la seule livraison réservée');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM FinishedStockReservation WHERE orderLineId=?').get(b.lines[0].id).c, 0, 'réservations finies libérées');
}

// ---------------- SC-15 : fermeture, redémarrage et reprise après interruption ----------------
let serverHandle = null;
function spawnServer(port) {
  const s = spawn(process.execPath, ['scripts/start-gocmd-checked.cjs'], {
    cwd: root, detached: process.platform !== 'win32',
    env: { ...process.env, ...env, GOCMD_DB_FILE: testDB, GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_REQUIRE_RBAC: '1', GOCMD_ACCESS_PASSWORD: '', GOCMD_ALLOW_DEMO_DB: '1', GOCMD_SALES_TAX_RATES_BPS: '0,700,2000', GOCMD_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  s.stdout.on('data', () => {}); s.stderr.on('data', () => {});
  return s;
}
async function waitReady(s, u) {
  for (let i = 0; i < 160; i++) {
    if (s.exitCode !== null) throw new Error(`Serveur exit ${s.exitCode}`);
    try { const r = await fetch(`${u}/api/me`, { signal: AbortSignal.timeout(1200) }); if (r.status === 401) return; } catch {}
    await new Promise(r => setTimeout(r, 350));
  }
  throw new Error('serveur non prêt');
}
async function sc15() {
  // Préparation avant interruption : commande + réservation persistée.
  // AUDIT P5.15.27-B (AN-SC-15) : amorce par circuit MTS réel (voir seedDprLot).
  const lot1 = (await call('INVENTORY', 'POST', '/api/sales/finished-stock', { action: 'receive', productId: matelas.id, lotCode: 'SC15-LOT-A', qty: 2, sourceRef: DPR_SC15_A })).lot;
  assert.ok(lot1, 'réception du lot témoin via DPR');
  await call('QUALITY', 'POST', '/api/sales/finished-stock', { action: 'release', lotId: lot1.id, reason: 'Contrôle qualité conforme SC-15' });
  const o = (await createApprovedOrder('SALES', order([{ productId: matelas.id, qty: 2, unitPrice: matelas.unitPrice }]))).order;
  await driveOf((await workOrders(o.id))[0].id, ['prepare']);
  const reservedBefore = db.prepare('SELECT COUNT(*) c FROM FinishedStockReservation WHERE orderLineId=?').get(o.lines[0].id).c;
  assert.ok(reservedBefore >= 1, 'réservation en place avant l’interruption');
  const ordersBefore = db.prepare('SELECT COUNT(*) c FROM "Order"').get().c;
  const countersBefore = db.prepare('SELECT id, value FROM SalesDocCounter ORDER BY id').all();

  // Interruption brutale (SIGKILL au groupe de processus).
  assert(serverHandle, 'serveur actif requis');
  const killed = serverHandle;
  process.kill(-killed.pid, 'SIGKILL');
  await new Promise(r => setTimeout(r, 800));

  // Contrôles base à froid : intégrité, FK, aucune écriture partielle.
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok', 'intégrité SQLite après SIGKILL');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0, 'aucune violation FK après SIGKILL');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM "Order"').get().c, ordersBefore, 'aucune commande perdue ni dupliquée');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM FinishedStockReservation WHERE orderLineId=?').get(o.lines[0].id).c, reservedBefore, 'réservations persistées après crash');

  // Redémarrage sur la même base, puis reprise métier.
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  serverHandle = spawnServer(port);
  await waitReady(serverHandle, url);
  const seen = (await call('SALES', 'GET', '/api/orders?take=200')).items.find(x => x.id === o.id);
  assert.ok(seen && /CMD-/.test(seen.ref), 'commande relue après redémarrage');

  // Les compteurs ne repartent pas à zéro : aucune référence dupliquée.
  const o2 = (await createApprovedOrder('SALES', order([{ productId: matelas.id, qty: 1, unitPrice: matelas.unitPrice }]))).order;
  assert.notEqual(o2.ref, o.ref, 'référence CMD différente après redémarrage');
  const refs = db.prepare('SELECT ref, COUNT(*) c FROM "Order" GROUP BY ref HAVING c>1').all();
  assert.equal(refs.length, 0, 'aucune référence CMD dupliquée après redémarrage');
  const countersAfter = db.prepare('SELECT id, value FROM SalesDocCounter ORDER BY id').all();
  for (const c of countersBefore) {
    const after = countersAfter.find(x => x.id === c.id);
    assert.ok(after && after.value >= c.value, `compteur ${c.id} monotone après redémarrage`);
  }

  // La livraison de la commande interrompue reprend et réussit.
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'advance' });
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'advance' });
  const d = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, stockLines: [{ orderLineId: o.lines[0].id, qty: 2 }], requestKey: randomUUID() })).delivery;
  assert.ok(/BLC-/.test(d.ref), 'livraison reprise après interruption');
  assert.equal(db.prepare('SELECT qty FROM FinishedStockLot WHERE id=?').get(lot1.id).qty, 0, 'lot fini débité exactement une fois');
}

// ---------------- ORCHESTRATION ----------------
(async () => {
  const port = await freePort(); url = `http://127.0.0.1:${port}`;
  serverHandle = spawnServer(port);
  const abort = () => { const s = serverHandle; if (!s || s.exitCode !== null) return; try { process.kill(-s.pid, 'SIGKILL'); } catch { try { s.kill('SIGKILL'); } catch {} } };
  process.on('exit', abort);
  try {
    await waitReady(serverHandle, url);
    await check('SC-13', 'modification d’une CMD après génération des OF → lignes figées, snapshots intacts, suspension/reprise tracées', sc13);
    await check('SC-14', 'préparation d’un OF puis mouvement concurrent de stock avant livraison → réservations protégées, aucun double débit', sc14);
    await check('SC-15', 'fermeture brutale, redémarrage et reprise → intégrité, compteurs monotones, livraison reprise', sc15);
  } finally { abort(); }
  const failed = results.filter(r => r.result === 'FAIL');
  console.log('\n===== RÉCAPITULATIF RECETTE COMPLÉMENTAIRE (SC-13..SC-15) =====');
  for (const r of results) console.log(`${r.result}  ${r.id}  ${r.title}${r.detail ? '  → ' + r.detail : ''}`);
  console.log(`TOTAL : ${results.length - failed.length}/${results.length} PASS — ${n} requêtes HTTP — base jetable ${testDB}`);
  if (failed.length) process.exit(1);
})().catch(e => { console.error('ERREUR ORCHESTRATEUR :', e.message); process.exit(1); });
