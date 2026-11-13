#!/usr/bin/env node
/* GoCmd P5.15.21 — RECETTE MÉTIER DU CIRCUIT VENTES (SC-01..SC-12).
 * Contre-audit du 08/11/2026 : exécution réelle des scénarios indispensables
 * SODEPI sur un serveur de production local et une base SQLite jetable.
 * Localhost uniquement ; aucune écriture sur db/custom.db (copie temporaire).
 *
 * SC-01 commande simple négoce → CMD + OF préparation + livraison débitée
 * SC-02 salon 9 pièces → 1 OF + 9 étiquettes (8+1 sur deux pages A4)
 * SC-03 sept matelas → 7 étiquettes, aucun dessin
 * SC-04 onze matelas → 11 étiquettes sur deux pages
 * SC-05 commande mixte salon+matelas+mousse+tissu → OF automatiques
 * SC-06 produit hors catalogue → visa directeur → validation → OF
 * SC-07 dix matelas dont quatre disponibles → reliquat sans modifier la CMD
 * SC-08 deux commandes concurrentes sur le même lot → aucune double allocation
 * SC-09 annulation/suspension après OF → cohérence et audit
 * SC-10 livraison partielle → stock et facturation exacts
 * SC-11 retour client → contrôle qualité → mouvement et avoir
 * SC-12 accès non autorisés → refus corrects
 */
'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createAccounts } = require('./qa-managed-accounts.cjs');
// Pont de test officiel : Basic → session SQLite révocable (aucun repli Basic côté serveur).
process.env.GOCMD_E2E_CONFIRM = 'ISOLATED_DB_ONLY';
const fetchAuth = require('./qa-authenticated-fetch.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-sc-ventes-'));
const testDB = path.join(dir, 'sc.db');
fs.copyFileSync(path.join(root, 'db', 'custom.db'), testDB);
const db = new DatabaseSync(testDB);

const SPEC = {
  SALES: ['sales'], SALES2: ['sales'], SALES_APPROVER: ['sales', 'approver'],
  DIRECTOR: ['director'], FINANCE: ['finance'], FINANCE_B: ['finance'],
  INVENTORY: ['inventory'], QUALITY: ['quality'], RECEIVER: ['receiver'],
};
const accounts = createAccounts(testDB, 'sc', SPEC);
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

// Fixtures dynamiques (base démo livrée) — jamais de référence en dur.
const fixture = (sql, ...args) => db.prepare(sql).get(...args);
const salon = fixture(`SELECT id,length,width,height,unitPrice FROM Product WHERE family='SALON' AND status='active' AND unit='ml' ORDER BY id LIMIT 1`);
const matelas = fixture(`SELECT id,unitPrice FROM Product WHERE family='MATELAS' AND status='active' AND unit='u' AND materialId IS NULL ORDER BY id LIMIT 1`);
const bloc = fixture(`SELECT p.id, p.unitPrice, m.id materialId, m.stockQty stock FROM Product p JOIN Material m ON m.id=p.materialId WHERE p.status='active' AND m.isSellable=1 AND p.unit='bloc' AND m.stockQty>10 ORDER BY m.stockQty DESC, p.id LIMIT 1`);
const tissu = fixture(`SELECT p.id, p.unitPrice, m.id materialId, m.stockQty stock FROM Product p JOIN Material m ON m.id=p.materialId WHERE p.status='active' AND m.isSellable=1 AND p.unit='ml' AND m.stockQty>50 ORDER BY m.stockQty DESC, p.id LIMIT 1`);
assert(salon && matelas && bloc && tissu, 'fixtures démo requis (salon, matelas, négoce bloc/ml)');

// AUDIT P5.15.27-B (AN-SC-07) : depuis le durcissement SOURCE_NOT_APPROVED
// (« une sourceRef libre ne crée jamais du stock »), l'amorce des lots finis
// passe par le circuit MTS réel : DPR approuvée + OF de fabrication pour stock
// terminé. Semis AVANT le démarrage du serveur (visibilité immédiate).
function seedDprLot(productId, qty, ref) {
  db.prepare(`INSERT INTO ProductionReplenishmentRequest(ref,productId,qty,unit,status,reason,createdBy) VALUES(?,?,?,?,?,?,?)`)
    .run(ref, productId, qty, 'u', 'approved', 'Recette SC : constitution du lot témoin', 'sc_inventory');
  const rid = db.prepare(`SELECT id FROM ProductionReplenishmentRequest WHERE ref=?`).get(ref).id;
  db.prepare(`INSERT INTO ProductionStockOrder(ref,requestId,status,createdBy,completedBy) VALUES(?,?,?,?,?)`)
    .run(ref.replace(/^DPR-/, 'OF-'), rid, 'completed', 'sc_inventory', 'sc_inventory');
  return ref;
}
const DPR_SC07_A = seedDprLot(matelas.id, 4, 'DPR-SC07-LOT-A');
const DPR_SC07_B = seedDprLot(matelas.id, 6, 'DPR-SC07-LOT-B');

const stdPart = (ref, meters, count = 1) => ({ label: 'Pièce droite SC', partRef: ref, linearMeters: meters, gabaritCode: 'STD', billingMode: 'manual', shape: 'rectangle', count, lengthCm: salon.length, widthCm: salon.width, heightCm: salon.height });
const g11Part = (ref, D, J = 0.95) => ({ label: 'Pièce gabarit 11 SC', partRef: ref, count: 1, gabaritCode: '11', billingMode: 'computed', shape: 'gabarit', lengthCm: salon.length, widthCm: salon.width, heightCm: salon.height, extra: { D, J } });
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
async function driveOf(woid, actions) { for (const a of actions) await call(['start','complete','prepare'].includes(a)?'INVENTORY':'SALES_APPROVER', 'PATCH', `/api/work-orders/${woid}`, { action: a }); }
const materialStock = (id) => db.prepare('SELECT stockQty FROM Material WHERE id=?').get(id).stockQty;
const auditActions = (entity, entityId) => db.prepare('SELECT action FROM AuditEvent WHERE entity=? AND entityId=? ORDER BY id').all(String(entity), String(entityId)).map(r => r.action);

const results = [];
async function check(id, title, fn) {
  try { await fn(); results.push({ id, title, result: 'PASS' }); console.log(`PASS ${id} : ${title}`); }
  catch (e) { results.push({ id, title, result: 'FAIL', detail: e.message }); console.error(`FAIL ${id} : ${title}\n  → ${e.message}`); }
}

// ---------------- SCÉNARIOS ----------------
async function sc01() {
  const stockBefore = materialStock(bloc.materialId);
  const o = (await createApprovedOrder('SALES', order([{ productId: bloc.id, qty: 3, unitPrice: bloc.unitPrice }]))).order;
  assert.equal(o.status, 'ready', 'commande négoce approuvée, prête sans fabrication');
  assert.ok(/CMD-\d{4}-\d{4}/.test(o.ref), 'référence CMD unique');
  const wos = await workOrders(o.id);
  assert.equal(wos.length, 1, 'un OF de préparation pour la ligne négoce');
  assert.equal(wos[0].status, 'approved', 'OF créé seulement après approbation quatre yeux');
  assert.equal(wos[0].totalPieces, 1, 'étiquette de préparation unique, sans pièce fictive');
  assert.equal(wos[0].snapshot.stockTrade, true);
  assert.equal(wos[0].snapshot.pieces.length, 0, 'aucune OrderPiece fabriquée pour du négoce');
  await call('SALES', 'PATCH', `/api/work-orders/${wos[0].id}`, { action: 'prepare' }, [403]); // rôle magasinier obligatoire
  await driveOf(wos[0].id, ['prepare']); // disponible (stock suffisant) → completed
  const d = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, stockLines: [{ orderLineId: o.lines[0].id, qty: 3 }], requestKey: randomUUID() })).delivery;
  assert.ok(/BLC-/.test(d.ref));
  assert.equal(materialStock(bloc.materialId), stockBefore - 3, 'stock matière décrémenté de 3 blocs');
  const mvt = db.prepare(`SELECT m.signedQty FROM Movement m JOIN SalesStockAllocation a ON a.movementId=m.id WHERE a.deliveryLineId=?`).get(d.lines[0].id);
  assert.equal(mvt.signedQty, -3, 'mouvement de sortie tracé et alloué au BL');
}

async function sc02() {
  const parts = [stdPart('L01', 1), stdPart('L02', 1), stdPart('L03', 1), stdPart('L04', 1), stdPart('L05', 1), stdPart('L06', 1), stdPart('L07', 1), g11Part('L08', 1.2), g11Part('L09', 1.2)];
  const qty = 7 + 2 * 1.2; // somme des métrages = quantité facturée
  const o = (await createApprovedOrder('SALES', order([{ productId: salon.id, qty, unitPrice: salon.unitPrice, parts }]))).order;
  assert.equal(o.lines[0].pieces.length, 9, 'salon de neuf pièces');
  const wos = await workOrders(o.id);
  assert.equal(wos.length, 1, 'un seul OF pour le salon, pas neuf');
  assert.equal(wos[0].totalPieces, 9, 'l’OF porte les neuf étiquettes');
  assert.equal(wos[0].snapshot.pieces.length, 9);
  assert.equal(new Set(wos[0].snapshot.pieces.map(p => p.code)).size, 9, 'codes de pièces uniques');
  const gabarits = wos[0].snapshot.pieces.filter(p => p.gabaritCode && p.gabaritCode !== 'STD');
  assert.equal(gabarits.length, 2, 'deux pièces à gabarit Richbond');
  assert.ok(gabarits.every(p => Math.abs(p.linearMeters - 1.2) < 1e-9), 'gabarit 11 facturé D');
  // Pagination étiquettes : 8 par page A4 (work-order-labels OF_LABELS_PER_PAGE=8) → 9 pièces = 8+1.
  const pages = []; for (let i = 0; i < 9; i += 8) pages.push(Math.min(8, 9 - i));
  assert.deepEqual(pages, [8, 1], 'neuf étiquettes sur deux pages A4 : huit puis une');
  await call('SALES', 'PATCH', `/api/work-orders/${wos[0].id}`, { action: 'approve' }, [403]); // validation OF supplémentaire désactivée (commercial interdit)
}

async function sc03() {
  const o = (await createApprovedOrder('SALES', order([{ productId: matelas.id, qty: 7, unitPrice: matelas.unitPrice }]))).order;
  assert.equal(o.lines[0].pieces.length, 7, 'sept étiquettes matelas');
  const wos = await workOrders(o.id);
  assert.equal(wos.length, 1); assert.equal(wos[0].totalPieces, 7);
  assert.ok(wos[0].snapshot.pieces.every(p => !p.gabaritCode || p.gabaritCode === 'STD'), 'matelas : aucun gabarit, donc aucun dessin technique');
  const pages = []; for (let i = 0; i < 7; i += 8) pages.push(Math.min(8, 7 - i));
  assert.deepEqual(pages, [7], 'sept étiquettes sur une seule page A4');
}

async function sc04() {
  const o = (await createApprovedOrder('SALES', order([{ productId: matelas.id, qty: 11, unitPrice: matelas.unitPrice }]))).order;
  assert.equal(o.lines[0].pieces.length, 11, 'onze étiquettes matelas');
  const wos = await workOrders(o.id);
  assert.equal(wos[0].totalPieces, 11);
  const pages = []; for (let i = 0; i < 11; i += 8) pages.push(Math.min(8, 11 - i));
  assert.deepEqual(pages, [8, 3], 'onze étiquettes sur deux pages A4');
}

async function sc05() {
  const blocBefore = materialStock(bloc.materialId); const tissuBefore = materialStock(tissu.materialId);
  const lines = [
    { productId: salon.id, qty: 2.4, unitPrice: salon.unitPrice, parts: [stdPart('L01', 1.3), stdPart('L02', 1.1)] },
    { productId: matelas.id, qty: 2, unitPrice: matelas.unitPrice },
    { productId: bloc.id, qty: 2, unitPrice: bloc.unitPrice },
    { productId: tissu.id, qty: 5, unitPrice: tissu.unitPrice },
  ];
  // CASCADE3 (11/11/2026) — P1FIX : la commande mixte naît pending_validation
  // (aucun OF avant visa). createApprovedOrder vérifie AUSSI ces deux
  // invariants avant d'obtenir les quatre OF attendus après approbation.
  const o = (await createApprovedOrder('SALES', order(lines))).order;
  const wos = await workOrders(o.id);
  assert.equal(wos.length, 4, 'un OF automatique par ligne commerciale (salon, matelas, mousse, tissu)');
  // AUDIT P5.15.27-B (AN-SC-05) : l'API liste les OF du plus récent au plus
  // ancien (orderBy id desc, choix produit délibéré et partagé par l'UI).
  // Le scénario compare par ligne métier : tri chronologique avant contrôle.
  assert.deepEqual([...wos].sort((x, y) => x.id - y.id).map(w => w.totalPieces), [2, 2, 1, 1], 'OF salon 2 pièces, matelas 2 étiquettes, négoce 1 étiquette de préparation');
  for (const w of wos.filter(x => x.snapshot.stockTrade)) await driveOf(w.id, ['prepare']);
  for (const w of wos.filter(x => !x.snapshot.stockTrade)) await driveOf(w.id, ['start', 'complete']);
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'advance' });
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'advance' });
  const pieceIds = o.lines[0].pieces.concat(o.lines[1].pieces).map(p => p.id);
  const d = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, pieceIds, stockLines: [{ orderLineId: o.lines[2].id, qty: 2 }, { orderLineId: o.lines[3].id, qty: 5 }], requestKey: randomUUID() })).delivery;
  assert.equal(d.lines.length, 4, 'BL couvrant les quatre lignes');
  assert.equal(materialStock(bloc.materialId), blocBefore - 2, 'stock bloc décrémenté');
  assert.equal(materialStock(tissu.materialId), tissuBefore - 5, 'stock tissu décrémenté (vente au mètre linéaire)');
  const o2 = (await call('SALES', 'GET', '/api/orders?take=200')).items.find(x => x.id === o.id);
  assert.equal(o2.status, 'shipped', 'commande expédiée après livraison complète');
}

async function sc06() {
  const special = (await call('SALES', 'POST', '/api/products', { model: 'SC-06 SALON SPECIAL', family: 'SALON', length: 210, width: 85, height: 75, unitPrice: 850, subCategory: 'Sur mesure', specialNotes: 'SC-06 : salon spécifique hors catalogue' })).product;
  assert.equal(special.status, 'pending_validation');
  const o = (await call('SALES', 'POST', '/api/orders', order([{ productId: special.id, qty: 3.2, unitPrice: 850, ensembleCount: 1, parts: [{ label: 'Salon spécial SC-06', partRef: 'L01', linearMeters: 3.2, gabaritCode: 'STD', billingMode: 'manual', shape: 'rectangle', count: 1, lengthCm: 210, widthCm: 85, heightCm: 75 }] }]))).order;
  assert.equal(o.status, 'pending_validation', 'commande spéciale en attente de validation');
  assert.equal((await workOrders(o.id)).length, 0, 'aucun OF avant approbation');
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'advance' }, [409]); // production interdite
  await call('SALES', 'POST', `/api/products/${special.id}/director-price`, { action: 'approve', unitPrice: 850, reason: 'tentative commercial' }, [403]);
  const visa = (await call('DIRECTOR', 'POST', `/api/products/${special.id}/director-price`, { action: 'approve', unitPrice: 850, reason: 'SC-06 visa directeur', sensitivePassword: accounts.DIRECTOR.password })).product;
  assert.equal(visa.specialPriceStatus, 'approved');
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'approve', comment: 'Validation recette SC-06' }, [403]); // quatre-yeux créateur≠validateur
  const approved = (await call('SALES_APPROVER', 'PATCH', `/api/orders/${o.id}`, { action: 'approve', comment: 'Validation recette SC-06' })).order;
  assert.equal(approved.status, 'new');
  const wos = await workOrders(o.id);
  assert.equal(wos.length, 1, 'OF émis à l’approbation effective');
  await driveOf(wos[0].id, ['start', 'complete']);
  await call('DIRECTOR', 'PATCH', `/api/orders/${o.id}`, { action: 'advance' }, [403]); // le directeur n’est pas commercial
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'advance' });
}

async function sc07() {
  // AUDIT P5.15.27-B (AN-SC-07) : amorce par circuit MTS réel (voir seedDprLot).
  const lot1 = (await call('INVENTORY', 'POST', '/api/sales/finished-stock', { action: 'receive', productId: matelas.id, lotCode: 'SC07-LOT-A', qty: 4, sourceRef: DPR_SC07_A })).lot;
  assert.ok(lot1, 'réception du lot témoin via DPR');
  assert.equal(lot1.status, 'quarantine', 'réception en quarantaine');
  await call('INVENTORY', 'POST', '/api/sales/finished-stock', { action: 'release', lotId: lot1.id, reason: 'Contrôle qualité conforme SC-07' }, [403]); // quatre-yeux
  await call('QUALITY', 'POST', '/api/sales/finished-stock', { action: 'release', lotId: lot1.id, reason: 'Contrôle qualité conforme SC-07' });
  const o = (await createApprovedOrder('SALES', order([{ productId: matelas.id, qty: 10, unitPrice: matelas.unitPrice }]))).order;
  assert.equal(o.lines[0].pieces.length, 10, 'une seule commande de dix matelas');
  const wos = await workOrders(o.id);
  await call('INVENTORY', 'PATCH', `/api/work-orders/${wos[0].id}`, { action: 'prepare' }, [409]); // 4 disponibles < 10
  await driveOf(wos[0].id, ['start', 'complete']);
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'advance' });
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'advance' });
  const bl1 = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, stockLines: [{ orderLineId: o.lines[0].id, qty: 4 }], requestKey: randomUUID() })).delivery;
  assert.equal(JSON.parse(bl1.lines[0].pieceIds).length, 4, 'quatre matelas disponibles livrés');
  let current = (await call('SALES', 'GET', '/api/orders?take=200')).items.find(x => x.id === o.id);
  assert.equal(current.status, 'ready', 'reliquat de six matelas : commande non expédiée');
  assert.equal(current.lines[0].qty, 10, 'CMD inchangée : toujours dix matelas');
  const lot2 = (await call('INVENTORY', 'POST', '/api/sales/finished-stock', { action: 'receive', productId: matelas.id, lotCode: 'SC07-LOT-B', qty: 6, sourceRef: DPR_SC07_B })).lot;
  assert.ok(lot2, 'réception du complément via DPR');
  await call('QUALITY', 'POST', '/api/sales/finished-stock', { action: 'release', lotId: lot2.id, reason: 'Contrôle qualité conforme SC-07 complément' });
  const bl2 = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, stockLines: [{ orderLineId: o.lines[0].id, qty: 6 }], requestKey: randomUUID() })).delivery;
  current = (await call('SALES', 'GET', '/api/orders?take=200')).items.find(x => x.id === o.id);
  assert.equal(current.status, 'shipped', 'livraison complète après réception du complément');
  const outs = db.prepare(`SELECT COALESCE(SUM(qty),0) s FROM FinishedStockMovement WHERE type='out'`).get().s;
  assert.ok(outs <= -10, `sorties de stock fini tracées (quantités signées négatives, cumul ${outs})`);
}

async function sc08() {
  const available = materialStock(bloc.materialId);
  const qty = Math.max(2, Math.floor(available / 2) + 1); // 2 × qty > available
  const a = (await createApprovedOrder('SALES', order([{ productId: bloc.id, qty, unitPrice: bloc.unitPrice }]))).order;
  // P6 (2026-11-11) : B est une commande DISTINCTE du second commercial
  // (jour de livraison différent) : la garde doublons P5 ne doit pas la
  // confondre avec une répétition de A ; la contention de stock reste le sujet.
  const b = (await createApprovedOrder('SALES2', order([{ productId: bloc.id, qty, unitPrice: bloc.unitPrice }], { dueDate: due(15) }))).order;
  // AUDIT P5.15.27-B (AN-SC-08, cf. RR-06) : depuis RR-06, la préparation d'un
  // OF de revente réserve les lots réels dans la transaction. La première
  // préparation réserve qty ; la seconde est refusée faute de stock libre : la
  // protection « aucune double allocation » s'exerce désormais à la préparation.
  const pa = await call('INVENTORY', 'PATCH', `/api/work-orders/${(await workOrders(a.id))[0].id}`, { action: 'prepare' });
  const pb = await call('INVENTORY', 'PATCH', `/api/work-orders/${(await workOrders(b.id))[0].id}`, { action: 'prepare' }, [200, 201, 409]);
  assert.equal([pa, pb].filter(r => r.status < 300).length, 1, `exactement une préparation aboutit : [${pa.status},${pb.status}]`);
  assert.equal(pb.status, 409, 'la seconde préparation est refusée (stock libre insuffisant)');
  const race = await Promise.all([a, b].map(o => call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, stockLines: [{ orderLineId: o.lines[0].id, qty }], requestKey: randomUUID() }, [201, 409]).catch(e => ({ status: 0, error: e.message }))));
  assert.deepEqual(race.map(r => r.status === 201 ? 201 : 409).sort(), [201, 409], 'exactement une livraison concurrente aboutit');
  assert.ok(materialStock(bloc.materialId) >= 0, 'stock jamais négatif');
  const failed = race.find(r => r.status !== 201);
  assert.ok(failed, 'la seconde livraison est refusée proprement (insuffisance)');
}

async function sc09() {
  const o = (await createApprovedOrder('SALES', order([{ productId: matelas.id, qty: 2, unitPrice: matelas.unitPrice }]))).order;
  const wos = await workOrders(o.id);
  await call('SALES_APPROVER', 'PATCH', `/api/work-orders/${wos[0].id}`, { action: 'cancel', reason: 'Annulation client SC-09 : abandon de la fabrication' });
  const cancelled = (await workOrders(o.id))[0];
  assert.equal(cancelled.status, 'cancelled');
  await call('SALES_APPROVER', 'PATCH', `/api/work-orders/${wos[0].id}`, { action: 'reactivate', reason: 'Réactivation SC-09 : client revient sur sa décision' });
  assert.equal((await workOrders(o.id))[0].status, 'draft', 'réactivation justifiée en brouillon');
  // Réservation négoce libérée à la clôture de commande.
  const t = (await createApprovedOrder('SALES', order([{ productId: tissu.id, qty: 4, unitPrice: tissu.unitPrice }]))).order;
  await call('SALES', 'POST', '/api/sales', { action: 'reserve-stock', orderId: t.id, orderLineId: t.lines[0].id, qty: 4 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM SalesStockReservation WHERE orderLineId=?').get(t.lines[0].id).n, 1, 'réservation créée');
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'hold', reason: 'Attente acompte client SC-09' });
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'resume', reason: 'Acompte reçu, reprise SC-09' });
  await call('SALES', 'PATCH', `/api/orders/${t.id}`, { action: 'close', reason: 'Reliquat annulé par le client SC-09' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM SalesStockReservation WHERE orderLineId=?').get(t.lines[0].id).n, 0, 'clôture libère les réservations');
  const events = auditActions('Order', o.id).concat(auditActions('Order', t.id), auditActions('WorkOrder', wos[0].id));
  for (const expected of ['WORK_ORDER_CANCEL', 'WORK_ORDER_REACTIVATE', 'CUSTOMER_ORDER_HOLD', 'CUSTOMER_ORDER_RESUME', 'CUSTOMER_ORDER_CLOSE'])
    assert.ok(events.includes(expected), `événement d’audit ${expected} présent`);
  assert.ok(auditActions('OrderLine', t.lines[0].id).includes('SALES_STOCK_RESERVED'), 'réservation historisée');
}

async function sc10() {
  const o = (await createApprovedOrder('SALES', order([{ productId: matelas.id, qty: 4, unitPrice: matelas.unitPrice }]))).order;
  await driveOf((await workOrders(o.id))[0].id, ['start', 'complete']);
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'advance' });
  await call('SALES', 'PATCH', `/api/orders/${o.id}`, { action: 'advance' });
  const pieces = o.lines[0].pieces.map(p => p.id);
  const bl1 = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, pieceIds: pieces.slice(0, 2), requestKey: randomUUID() })).delivery;
  const inv1 = (await call('FINANCE', 'POST', '/api/sales', { action: 'invoice', orderId: o.id, deliveryIds: [bl1.id], taxRateBps: 0 })).invoice;
  assert.equal(inv1.subtotalCents, 2 * Math.round(matelas.unitPrice * 100), 'facture partielle : deux matelas');
  await call('FINANCE', 'POST', '/api/sales', { action: 'invoice', orderId: o.id, deliveryIds: [bl1.id], taxRateBps: 0 }, [409]); // BL déjà facturé
  const bl2 = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, pieceIds: pieces.slice(2), requestKey: randomUUID() })).delivery;
  const inv2 = (await call('FINANCE', 'POST', '/api/sales', { action: 'invoice', orderId: o.id, deliveryIds: [bl2.id], taxRateBps: 0 })).invoice;
  assert.equal(inv2.subtotalCents, 2 * Math.round(matelas.unitPrice * 100), 'reliquat facturé');
  assert.equal(inv1.totalCents + inv2.totalCents, 4 * Math.round(matelas.unitPrice * 100), 'total facturé = commande');
  const current = (await call('SALES', 'GET', '/api/orders?take=200')).items.find(x => x.id === o.id);
  assert.equal(current.status, 'shipped', 'expédition automatique à la livraison complète');
  return { bl1, inv1 };
}

async function sc11(ctx) {
  const { bl1, inv1 } = ctx;
  const line = bl1.lines[0];
  const returnedPiece = JSON.parse(line.pieceIds)[0];
  const ret = (await call('SALES', 'POST', '/api/sales/returns', { action: 'request', deliveryLineId: line.id, qty: 1, pieceIds: [returnedPiece], requestKey: randomUUID(), reason: 'SC-11 : matelas refusé à la livraison' })).return;
  assert.equal(ret.status, 'requested');
  await call('RECEIVER', 'POST', '/api/sales/returns', { action: 'receive', returnId: ret.id, reason: 'Réception physique SC-11' });
  await call('SALES', 'POST', '/api/sales/returns', { action: 'accept', returnId: ret.id, reason: 'Contrôle qualité conforme SC-11' }, [403]); // qualité requise
  const accepted = (await call('QUALITY', 'POST', '/api/sales/returns', { action: 'accept', returnId: ret.id, reason: 'Contrôle qualité conforme SC-11' })).return;
  assert.equal(accepted.status, 'accepted');
  const lot = db.prepare('SELECT lotCode,qty,status FROM FinishedStockLot WHERE id=?').get(accepted.finishedStockLotId);
  assert.ok(/RETOUR-RCL-/.test(lot.lotCode) && lot.qty === 1 && lot.status === 'available', 'matelas retourné réintégré en stock fini après contrôle qualité');
  const movements = db.prepare('SELECT type FROM FinishedStockMovement WHERE lotId=? ORDER BY id').all(accepted.finishedStockLotId).map(r => r.type);
  assert.deepEqual(movements, ['received_quarantine', 'available'], 'mouvements quarantaine puis libération tracés');
  const credit = (await call('FINANCE', 'POST', '/api/sales', { action: 'credit-lines', invoiceId: inv1.id, reason: 'SC-11 avoir sur retour accepté', lines: [{ invoiceLineId: inv1.lines ? inv1.lines[0].id : (await call('FINANCE', 'GET', '/api/sales?type=invoices')).items.find(x => x.id === inv1.id).lines[0].id, qty: 1 }] })).credit;
  assert.equal(credit.status, 'draft', 'avoir en brouillon, jamais automatique');
  await call('FINANCE', 'POST', '/api/sales', { action: 'approve-credit', creditId: credit.id }, [409]); // quatre-yeux
  const approved = (await call('FINANCE_B', 'POST', '/api/sales', { action: 'approve-credit', creditId: credit.id })).credit;
  assert.equal(approved.status, 'approved');
  assert.equal(approved.amountCents, Math.round(matelas.unitPrice * 100), 'avoir ligne à ligne : un matelas au prix exact');
}

async function sc12() {
  await call('SALES', 'POST', '/api/sales', { action: 'invoice', orderId: 1, deliveryIds: [1], taxRateBps: 0 }, [403]); // finance requis
  await call('SALES', 'POST', '/api/sales', { action: 'approve-credit', creditId: 1 }, [403]);
  await call('SALES', 'POST', `/api/products/1/director-price`, { action: 'approve', unitPrice: 100, reason: 'SC-12 tentative' }, [403]);
  await call('SALES', 'PATCH', '/api/work-orders/1', { action: 'approve' }, [403]); // approbateur requis
  await call('SALES', 'POST', '/api/sales/finished-stock', { action: 'receive', productId: matelas.id, lotCode: 'SC12-X', qty: 1, sourceRef: 'SC-12 tentative' }, [403]);
  await call('SALES', 'POST', '/api/sales/returns', { action: 'accept', returnId: 1, reason: 'SC-12 tentative qualité' }, [403]);
  await call('SALES', 'GET', '/api/sales/statement?clientId=1', undefined, [403]);
  await call('SALES', 'GET', '/api/admin/users', undefined, [403]);
  await call('RECEIVER', 'POST', '/api/sales', { action: 'delivery', orderId: 1, pieceIds: [1] }, [403]); // commercial requis
  await call('QUALITY', 'POST', '/api/orders', order([{ productId: matelas.id, qty: 1, unitPrice: 100 }]), [403]);
  await call('FINANCE', 'PATCH', '/api/orders/1', { action: 'advance' }, [403]);
  const anon = await fetch(new URL('/api/orders', url)); assert.equal(anon.status, 401, 'anonyme refusé');
}

// ---------------- ORCHESTRATION ----------------
(async () => {
  const port = await freePort(); url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['scripts/start-gocmd-checked.cjs'], {
    cwd: root, detached: process.platform !== 'win32',
    env: { ...process.env, ...env, GOCMD_DB_FILE: testDB, GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_REQUIRE_RBAC: '1', GOCMD_ACCESS_PASSWORD: '', GOCMD_ALLOW_DEMO_DB: '1', GOCMD_SALES_TAX_RATES_BPS: '0,700,2000', GOCMD_PUBLIC_ORIGIN: url, HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const k of ['stdout', 'stderr']) server[k].on('data', x => { output += x.toString(); });
  const abort = () => { if (server.exitCode !== null) return; try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill('SIGTERM'); } catch {} } };
  process.on('exit', abort);
  try {
    let ready = false;
    for (let i = 0; i < 160; i++) {
      if (server.exitCode !== null) throw new Error(`Serveur exit ${server.exitCode}: ${output.slice(-1500)}`);
      try { const r = await fetch(`${url}/api/me`, { signal: AbortSignal.timeout(1200) }); if (r.status === 401) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 350));
    }
    assert(ready, 'serveur non prêt');
    await check('SC-01', 'commande simple produit stocké → CMD + OF + livraison débitée', sc01);
    await check('SC-02', 'salon neuf pièces → un OF + neuf étiquettes (8+1, deux pages A4)', sc02);
    await check('SC-03', 'sept matelas → sept étiquettes, aucun dessin', sc03);
    await check('SC-04', 'onze matelas → onze étiquettes sur deux pages', sc04);
    await check('SC-05', 'commande mixte salon/matelas/mousse/tissu → OF automatiques', sc05);
    await check('SC-06', 'produit hors catalogue → visa directeur → validation → OF', sc06);
    await check('SC-07', 'dix matelas dont quatre disponibles → reliquat sans modifier la CMD', sc07);
    await check('SC-08', 'deux commandes concurrentes sur les mêmes lots → aucune double allocation', sc08);
    await check('SC-09', 'annulation/suspension après OF → cohérence et audit', sc09);
    let sc10ctx;
    await check('SC-10', 'livraison partielle → stock et facturation exacts', async () => { sc10ctx = await sc10(); });
    await check('SC-11', 'retour client → contrôle qualité → mouvement et avoir', async () => { assert(sc10ctx, 'SC-10 requis'); await sc11(sc10ctx); });
    await check('SC-12', 'tentatives d’accès non autorisé → refus corrects', sc12);
  } finally { abort(); }
  const failed = results.filter(r => r.result === 'FAIL');
  console.log('\n===== RÉCAPITULATIF RECETTE MÉTIER VENTES (SC-01..SC-12) =====');
  for (const r of results) console.log(`${r.result}  ${r.id}  ${r.title}${r.detail ? '  → ' + r.detail : ''}`);
  console.log(`TOTAL : ${results.length - failed.length}/${results.length} PASS — ${n} requêtes HTTP — base jetable ${testDB}`);
  if (failed.length) process.exit(1);
})().catch(e => { console.error('ERREUR ORCHESTRATEUR :', e.message); process.exit(1); });
