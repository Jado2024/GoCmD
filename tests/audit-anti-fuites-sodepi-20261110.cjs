#!/usr/bin/env node
/* GoCmd — AUDIT ANTI-FUITES SODEPI (mission 10/11/2026).
 * Exécution réelle sur serveur Next.js isolé + copie jetable de la base démo.
 * Aucune écriture sur db/custom.db (copie temporaire uniquement).
 *
 * Sections :
 *   A.  Cas obligatoire : prix catalogue 2000 MAD → 1500 MAD sans visa directeur.
 *   B.  Cas obligatoire : deux commandes × 4 matelas sur un stock de 4 (concurrence).
 *   B3. Négoce : double réservation matière (2 × stock disponible, en parallèle).
 *   C.  Fuites de prix d'achat / coûts vers rôles non habilités.
 *   D.  RBAC serveur (rôles, admin pur, session, anonyme, quatre-yeux).
 *   E.  CSRF / origines des mutations.
 *   F.  Injection & divulgation d'erreurs.
 *   G.  Financier : double facturation, paiements, avoirs, quatre-yeux financier.
 *   H.  Stock négatif / sur-livraison / doublons.
 *   I.  Immutabilité factures & historiques (niveau SQL, triggers).
 */
'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createAccounts, loginAccounts } = require('./qa-managed-accounts.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-audit-fuites-'));
const testDB = path.join(dir, 'audit.db');
fs.copyFileSync(path.join(root, 'db', 'custom.db'), testDB);
const db = new DatabaseSync(testDB);

const SPEC = {
  SALES: ['sales'], SALES2: ['sales'], SALES_APPROVER: ['sales', 'approver'],
  DIRECTOR: ['director'], APPROVER: ['approver'], BUYER: ['buyer'],
  FINANCE: ['finance'], FINANCE2: ['finance'], INVENTORY: ['inventory'],
  QUALITY: ['quality'], RECEIVER: ['receiver'], ADMINPURE: ['admin'],
};
const accounts = createAccounts(testDB, 'aud', SPEC);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}
let url; let cookies = {};
let serverHandle = null;
function spawnServer(port) {
  const s = spawn(process.execPath, ['scripts/start-gocmd-checked.cjs'], {
    cwd: root, detached: process.platform !== 'win32',
    env: {
      ...process.env, GOCMD_DB_FILE: testDB, GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_REQUIRE_RBAC: '1',
      GOCMD_ACCESS_PASSWORD: '',
      GOCMD_SALES_TAX_RATES_BPS: '0,700,1400,2000', GOCMD_ALLOW_DEMO_DB: '1',
      GOCMD_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  s.stdout.on('data', () => {}); s.stderr.on('data', () => {});
  return s;
}
async function waitReady(s, u) {
  for (let i = 0; i < 200; i++) {
    if (s.exitCode !== null) throw new Error(`Serveur exit ${s.exitCode}`);
    try { const r = await fetch(`${u}/api/me`, { signal: AbortSignal.timeout(1500) }); if (r.status === 401) return; } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('serveur non prêt');
}
/** Appel authentifié par session cookie, contrôle EXACT des en-têtes d'origine. */
async function call(role, method, pathName, data, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (role && cookies[role]) headers.cookie = cookies[role];
  if (opts.origin === 'none') { /* volontairement sans origine */ }
  else if (typeof opts.origin === 'string') headers.origin = opts.origin;
  else headers.origin = url;
  if (opts.secFetchSite) headers['sec-fetch-site'] = opts.secFetchSite;
  const r = await fetch(new URL(pathName, url), {
    method, headers, body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, headers: r.headers, json, text };
}
const due = (days = 14) => new Date(Date.now() + days * 86400e3).toISOString();
const order = (lines, extra = {}) => ({ clientId: 1, dueDate: due(), priority: 'normale', lines, ...extra });

// P6 (2026-11-11) : depuis P5.15.29-P5, une commande similaire (même client,
// même jour de livraison, même signature produits/quantités — ni le prix ni
// les dimensions ne comptent) reçoit 409 DUPLICATE_ORDER_POTENTIAL avec un
// jeton de revue. L'audit crée volontairement des commandes voisines (prix
// catalogue après une commande remisée, deuxième commande de contention de
// stock) : chacune est confirmée avec motif, comme l'interface le fait.
async function createOrder(role, body, opts) {
  let r = await call(role, 'POST', '/api/orders', body, opts);
  if (r.status === 409 && r.json && r.json.code === 'DUPLICATE_ORDER_POTENTIAL' && r.json.token) {
    r = await call(role, 'POST', '/api/orders', { ...body, duplicateReview: { token: r.json.token, reason: 'Commande distincte confirmée — audit anti-fuites SODEPI P6' } }, opts);
  }
  return r;
}

// Parcours positif : commande créée sous SALES/SALES2 puis approuvée par un autre compte.
async function createApprovedOrder(role, body) {
  const r=await createOrder(role,body);
  assert.equal(r.status,201);
  assert.equal(r.json.order.status,'pending_validation');
  assert.equal((await workOrders(r.json.order.id)).length,0,'aucun OF avant visa');
  const approved=await call('APPROVER','PATCH',`/api/orders/${r.json.order.id}`,{action:'approve',comment:'Recette SODEPI validation à quatre yeux'});
  assert.equal(approved.status,200,`approbation responsable : ${approved.status}`);
  return {...r,json:{...r.json,order:approved.json.order}};
}
const results = [];
async function check(id, title, fn) {
  try { await fn(); results.push({ id, title, result: 'PASS' }); console.log(`PASS ${id} : ${title}`); }
  catch (e) { results.push({ id, title, result: 'FAIL', detail: String(e.message || e) }); console.error(`FAIL ${id} : ${title}\n  → ${e.message}`); }
}
const fixture = (sql, ...args) => db.prepare(sql).get(...args);
const q = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);

/* ---------- Fixtures ---------- */
const matelasPrix = fixture(`SELECT id, unitPrice FROM Product WHERE family='MATELAS' AND status='active' AND unit='u' AND materialId IS NULL ORDER BY id LIMIT 1`);
assert(matelasPrix, 'fixture matelas requis');
db.prepare('UPDATE Product SET unitPrice=2000 WHERE id=?').run(matelasPrix.id);
const matelasResa = fixture(`SELECT id, unitPrice FROM Product WHERE family='MATELAS' AND status='active' AND unit='u' AND materialId IS NULL AND id<>? ORDER BY id LIMIT 1`, matelasPrix.id);
assert(matelasResa, 'fixture matelas 2 requis');
// Négoce A (réservation totale) et Négoce B (flux financier), matières distinctes.
const negoceA = fixture(`SELECT p.id, p.unitPrice, m.id materialId FROM Product p JOIN Material m ON m.id=p.materialId
  WHERE p.status='active' AND m.isSellable=1 AND p.unit='bloc' AND m.unit='bloc' ORDER BY m.stockQty DESC LIMIT 1`);
const negoceB = fixture(`SELECT p.id, p.unitPrice, m.id materialId FROM Product p JOIN Material m ON m.id=p.materialId
  WHERE p.status='active' AND m.isSellable=1 AND p.unit='bloc' AND m.unit='bloc' AND m.id<>? ORDER BY m.stockQty DESC LIMIT 1`, negoceA.materialId);
assert(negoceA && negoceB && negoceA.materialId !== negoceB.materialId, 'deux matières négoce distinctes requises');
const freeA = one(`SELECT COALESCE(SUM(qty),0) f FROM StockLot WHERE materialId=? AND status='available'`, negoceA.materialId).f;

// AUDIT P5.15.27-B (AN-AF-01) : depuis le durcissement voulu « une sourceRef
// libre ne crée jamais du stock » (SOURCE_NOT_APPROVED), la constitution du
// lot témoin de 4 matelas passe par le circuit MTS réel : DPR approuvée puis
// OF de fabrication pour stock terminé. Aucune réception libre admise.
db.prepare(`INSERT INTO ProductionReplenishmentRequest(ref,productId,qty,unit,status,reason,createdBy) VALUES(?,?,?,?,?,?,?)`)
  .run('DPR-AUDIT-FUITES-4', matelasResa.id, 4, 'u', 'approved', 'Audit anti-fuites : constitution du lot temoin', 'aud_inventory');
const dprAuditFuitesId = one(`SELECT id FROM ProductionReplenishmentRequest WHERE ref='DPR-AUDIT-FUITES-4'`).id;
db.prepare(`INSERT INTO ProductionStockOrder(ref,requestId,status,createdBy,completedBy) VALUES(?,?,?,?,?)`)
  .run('OF-AUDIT-FUITES-4', dprAuditFuitesId, 'completed', 'aud_inventory', 'aud_inventory');

async function workOrders(orderId) { return (await call('SALES', 'GET', `/api/work-orders?orderId=${orderId}`)).json.items; }

async function main() {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  serverHandle = spawnServer(port);
  await waitReady(serverHandle, url);
  cookies = await loginAccounts(url, accounts);

  /* ================= A. Cas obligatoire : prix 2000 → 1500 ================= */
  let orderPrix;
  await check('AUD-A1', 'CMD à 1500 MAD sur catalogue 2000 MAD → pending_validation, aucun OF', async () => {
    const r = await call('SALES', 'POST', '/api/orders', order([{ productId: matelasPrix.id, qty: 1, unitPrice: 1500 }]));
    assert.equal(r.status, 201, 'création attendue: ' + r.status + ' ' + r.text.slice(0, 200));
    orderPrix = r.json.order;
    assert.equal(orderPrix.status, 'pending_validation', 'statut: ' + orderPrix.status);
    assert.equal(orderPrix.lines[0].priceApprovalStatus, 'pending', 'ligne en attente de visa');
    const wos = await workOrders(orderPrix.id);
    assert.equal(wos.length, 0, 'AUCUN OF ne doit exister avant validation');
  });
  await check('AUD-A2', 'Lancement production (advance) refusé sur CMD non validée', async () => {
    const r = await call('SALES', 'PATCH', `/api/orders/${orderPrix.id}`, { action: 'advance' });
    assert.equal(r.status, 409, 'advance doit être refusé: ' + r.status);
  });
  await check('AUD-A3', 'Approbation tarifaire refusée pour un non-directeur (API directe)', async () => {
    for (const role of ['SALES2', 'APPROVER', 'FINANCE', 'ADMINPURE']) {
      const r = await call(role, 'PATCH', `/api/orders/${orderPrix.id}`, { action: 'approve-prices', reason: 'contournement testé' });
      assert.equal(r.status, 403, `${role} ne peut pas approuver les prix: ${r.status}`);
    }
  });
  await check('AUD-A4', 'Validateur classique (code validation) bloqué : visa directeur exigé', async () => {
    const r = await call('APPROVER', 'PATCH', `/api/orders/${orderPrix.id}`, { action: 'approve', comment: 'tentative approbateur classique' });
    assert.equal(r.status, 409, 'approve doit échouer (DIRECTOR_PRICE_REQUIRED): ' + r.status);
    assert.ok(/directeur|prix/i.test(r.json.error || ''), 'message directeur attendu');
  });
  await check('AUD-A4B', 'Le directeur doit confirmer personnellement un prix exceptionnel', async () => {
    // V2 R4 (COD-11) : le visa directeur appartient à UNE ligne (lineId), pas au panier.
    const lineId=orderPrix.lines[0].id
    const missing=await call('DIRECTOR', 'PATCH', `/api/orders/${orderPrix.id}`, {action:'approve-prices',lineId,reason:'Remise commerciale conforme test'});
    assert.equal(missing.status,400,'mot de passe personnel manquant');
    const wrong=await call('DIRECTOR', 'PATCH', `/api/orders/${orderPrix.id}`, {action:'approve-prices',lineId,reason:'Remise commerciale conforme test',sensitivePassword:'wrong-personal-password'});
    assert.equal(wrong.status,403,'confirmation incorrecte');
    assert.equal((await workOrders(orderPrix.id)).length,0,'aucun OF après une confirmation incorrecte');
  });
  await check('AUD-A5', 'Visa directeur puis responsable distinct → OF uniquement après approbation', async () => {
    const r = await call('DIRECTOR', 'PATCH', `/api/orders/${orderPrix.id}`, { action: 'approve-prices', lineId: orderPrix.lines[0].id, reason: 'Remise commerciale autorisée test audit', sensitivePassword: accounts.DIRECTOR.password });
    assert.equal(r.status, 200, 'approbation directeur attendue: ' + r.status + ' ' + r.text.slice(0, 200));
    assert.equal(r.json.order.status, 'pending_validation', 'visa prix ≠ approbation commande');
    assert.equal((await workOrders(orderPrix.id)).length,0,'aucun OF après visa directeur seul');
    const approval=await call('APPROVER','PATCH',`/api/orders/${orderPrix.id}`,{action:'approve',comment:'Approbation indépendante après visa du directeur'});
    assert.equal(approval.status,200);
    assert.equal(approval.json.order.status,'new');
    const wos = await workOrders(orderPrix.id);
    assert.equal(wos.length, 1, 'OF généré automatiquement après confirmation');
    assert.equal(wos[0].status, 'approved', 'OF déjà approuvé (pas de 2e approbation commerciale)');
    const evts = q(`SELECT action FROM AuditEvent WHERE entity='Order' AND entityId=? ORDER BY id`, String(orderPrix.id)).map(e => e.action);
    assert.ok(evts.includes('CUSTOMER_ORDER_PRICE_APPROVED'), 'trace audit du visa directeur');
  });
  await check('AUD-A6', 'CMD au prix catalogue exige aussi approbation responsable', async () => {
    const r = await createOrder('SALES', order([{ productId: matelasPrix.id, qty: 1, unitPrice: 2000 }]));
    assert.equal(r.status, 201);
    assert.equal(r.json.order.status, 'pending_validation', 'même le catalogue exige le quatre yeux');
    assert.equal((await workOrders(r.json.order.id)).length,0,'pas d OF avant approbation');
    const approval=await call('APPROVER','PATCH',`/api/orders/${r.json.order.id}`,{action:'approve',comment:'Approbation catalogue indépendante'});
    assert.equal(approval.status,200);
    const wos = await workOrders(r.json.order.id);
    assert.equal(wos.length, 1, 'OF immédiat au prix catalogue');
  });

  /* ================= B. Cas obligatoire : 2 × 4 matelas / 4 en stock ================= */
  await check('AUD-B1', 'Deux préparations OF concurrentes de 4 matelas sur stock de 4 : exactement une gagnante', async () => {
    // Garde produit explicitement contre-testée : une sourceRef arbitraire
    // ne crée jamais de stock (règle SOURCE_NOT_APPROVED, durcissement voulu).
    const libre = await call('INVENTORY', 'POST', '/api/sales/finished-stock', { action: 'receive', productId: matelasResa.id, lotCode: 'AUDIT-LOT-LIBRE', qty: 1, sourceRef: 'Audit : source arbitraire' });
    assert.equal(libre.status, 403, 'sourceRef libre refusee attendue : ' + libre.status + ' ' + libre.text.slice(0, 200));
    const recv = await call('INVENTORY', 'POST', '/api/sales/finished-stock', { action: 'receive', productId: matelasResa.id, lotCode: 'AUDIT-LOT-4', qty: 4, sourceRef: 'DPR-AUDIT-FUITES-4' });
    assert.equal(recv.status, 201, 'reception du lot temoin via DPR : ' + recv.status + ' ' + recv.text.slice(0, 200));
    const lot = recv.json.lot;
    await call('QUALITY', 'POST', '/api/sales/finished-stock', { action: 'release', lotId: lot.id, reason: 'Contrôle qualité conforme audit' });
    const o1 = (await createApprovedOrder('SALES', order([{ productId: matelasResa.id, qty: 4, unitPrice: matelasResa.unitPrice }]))).json.order;
    const o2 = (await createApprovedOrder('SALES2', order([{ productId: matelasResa.id, qty: 4, unitPrice: matelasResa.unitPrice }]))).json.order;
    const wo1 = (await workOrders(o1.id))[0], wo2 = (await workOrders(o2.id))[0];
    assert.ok(wo1 && wo2, 'OF des deux commandes présents');
    const [r1, r2] = await Promise.all([
      call('INVENTORY', 'PATCH', `/api/work-orders/${wo1.id}`, { action: 'prepare' }),
      call('INVENTORY', 'PATCH', `/api/work-orders/${wo2.id}`, { action: 'prepare' }),
    ]);
    const ok = [r1, r2].filter(r => r.status === 200).length;
    const ko = [r1, r2].filter(r => r.status === 409).length;
    assert.equal(ok, 1, `exactement une préparation réussie (obtenu ${ok}) : [${r1.status},${r2.status}]`);
    assert.equal(ko, 1, `exactement une préparation refusée (obtenu ${ko})`);
    const reserved = one(`SELECT COALESCE(SUM(qty),0) s FROM FinishedStockReservation WHERE lotId=?`, lot.id).s;
    assert.ok(Math.abs(reserved - 4) < 1e-6, `réservations totales = 4 (obtenu ${reserved})`);
    const lotQty = one(`SELECT qty FROM FinishedStockLot WHERE id=?`, lot.id).qty;
    assert.ok(Math.abs(lotQty - 4) < 1e-6, 'stock physique non débité à la réservation');
    assert.equal(one(`SELECT COUNT(*) c FROM FinishedStockReservation WHERE qty<0`).c, 0, 'aucune réservation négative');
  });
  await check('AUD-B2', 'Troisième commande bloquée : pas de double réservation en séquence', async () => {
    const o3 = (await createApprovedOrder('SALES', order([{ productId: matelasResa.id, qty: 1, unitPrice: matelasResa.unitPrice }]))).json.order;
    const wo3 = (await workOrders(o3.id))[0];
    const r = await call('INVENTORY', 'PATCH', `/api/work-orders/${wo3.id}`, { action: 'prepare' });
    assert.equal(r.status, 409, 'stock déjà entièrement réservé: ' + r.status);
  });

  /* ================= B3. Négoce : double réservation matière ================= */
  await check('AUD-B3', 'Deux réservations matière concurrentes du stock libre : une seule passe', async () => {
    const n1 = (await createApprovedOrder('SALES', order([{ productId: negoceA.id, qty: freeA, unitPrice: negoceA.unitPrice }]))).json.order;
    const n2 = (await createApprovedOrder('SALES2', order([{ productId: negoceA.id, qty: freeA, unitPrice: negoceA.unitPrice }]))).json.order;
    const [r1, r2] = await Promise.all([
      call('SALES', 'POST', '/api/sales', { action: 'reserve-stock', orderId: n1.id, orderLineId: n1.lines[0].id, qty: freeA }),
      call('SALES2', 'POST', '/api/sales', { action: 'reserve-stock', orderId: n2.id, orderLineId: n2.lines[0].id, qty: freeA }),
    ]);
    const ok = [r1, r2].filter(r => r.status === 200).length;
    assert.equal(ok, 1, `une seule réservation réussie (obtenu ${ok}) : [${r1.status},${r2.status}]`);
    const free = one(`SELECT COALESCE((SELECT SUM(qty) FROM StockLot WHERE materialId=? AND status='available'),0) - COALESCE((SELECT SUM(r.qty) FROM SalesStockReservation r JOIN StockLot l ON l.id=r.stockLotId WHERE l.materialId=?),0) f`, negoceA.materialId, negoceA.materialId).f;
    assert.ok(Math.abs(free) < 1e-6, `stock libre = 0 après la réservation gagnante (obtenu ${free})`);
  });

  /* ================= C. Fuites de prix d'achat / coûts ================= */
  await check('AUD-C1', 'Rôle qualité : prix d\'achat et CUMP masqués sur /api/materials', async () => {
    const r = await call('QUALITY', 'GET', '/api/materials');
    assert.equal(r.status, 200);
    const items = r.json.items || r.json;
    assert.ok(Array.isArray(items) && items.length > 0, 'réponse materials non vide');
    for (const m of items.slice(0, 80)) {
      assert.ok(m.unitPrice == null, `unitPrice visible pour ${m.ref || m.id}`);
      assert.ok(m.averageCost == null, `averageCost visible pour ${m.ref || m.id}`);
    }
  });
  await check('AUD-C2', 'Rôle acheteur : prix d\'achat visibles (témoin symétrique)', async () => {
    const r = await call('BUYER', 'GET', '/api/materials');
    assert.equal(r.status, 200);
    const items = r.json.items || r.json;
    assert.ok(items.some(m => m.unitPrice != null), 'acheteur doit voir les prix');
  });
  await check('AUD-C3', 'Rôle commercial : tarifs fournisseurs absents des BC', async () => {
    const r = await call('SALES', 'GET', '/api/supplier-orders');
    assert.equal(r.status, 200);
    for (const so of (r.json.items || [])) {
      for (const l of (so.lines || [])) {
        assert.ok(l.unitPrice == null && l.sourceUnitPrice == null, 'prix ligne BC visible pour rôle commercial: ' + JSON.stringify(l).slice(0, 120));
      }
    }
  });
  await check('AUD-C4', 'Export comptable réservé au rôle finance', async () => {
    const r = await call('SALES', 'GET', '/api/p2p/accounting-export');
    assert.equal(r.status, 403, 'export comptable doit être refusé: ' + r.status);
    const r2 = await call('QUALITY', 'GET', '/api/p2p/accounting-export');
    assert.equal(r2.status, 403);
  });
  await check('AUD-C5', 'Tableau de bord : valorisations financières masquées hors rôles coûts', async () => {
    const r = await call('QUALITY', 'GET', '/api/dashboard');
    assert.equal(r.status, 200);
    assert.ok(r.json.stockValue == null, 'stockValue ne doit pas être exposé à la qualité');
  });
  await check('AUD-C6', 'Réapprovisionnement (sources fournisseurs + délais) réservé aux rôles supply-chain', async () => {
    const r = await call('SALES', 'GET', '/api/p2p/replenishment');
    assert.equal(r.status, 403, 'un commercial ne doit pas cartographier les sources d\'approvisionnement: ' + r.status);
    const r2 = await call('BUYER', 'GET', '/api/p2p/replenishment');
    assert.equal(r2.status, 200, 'l\'acheteur accède au réapprovisionnement');
  });

  /* ================= D. RBAC serveur ================= */
  await check('AUD-D1', 'Rôle commercial écarté de /api/admin/users', async () => {
    const r = await call('SALES', 'GET', '/api/admin/users');
    assert.equal(r.status, 403, 'admin/users doit être refusé: ' + r.status);
  });
  await check('AUD-D2', 'Écritures matière réservées au rôle acheteur', async () => {
    const r = await call('SALES', 'POST', '/api/materials', { ref: 'AUDIT-X', name: 'x', category: 'Tissu', unit: 'ml', unitPrice: 1, stockQty: 0, minStock: 0 });
    assert.equal(r.status, 403, 'POST materials par commercial refusé: ' + r.status);
  });
  await check('AUD-D3', 'Mouvements de stock réservés au magasinier', async () => {
    const r = await call('QUALITY', 'POST', '/api/movements', { type: 'out', materialId: negoceB.materialId, qty: 1, reason: 'test' });
    assert.equal(r.status, 403, 'POST movements par qualité refusé: ' + r.status);
  });
  await check('AUD-D4', 'Accès anonyme refusé (401)', async () => {
    const r = await call(null, 'GET', '/api/orders');
    assert.equal(r.status, 401, 'anonyme: ' + r.status);
  });
  await check('AUD-D5', 'Compte administration pure : aucune API métier', async () => {
    for (const p of ['/api/orders', '/api/materials', '/api/sales?type=invoices', '/api/movements']) {
      const r = await call('ADMINPURE', 'GET', p);
      assert.equal(r.status, 403, `admin pur sur ${p}: ${r.status}`);
    }
  });
  await check('AUD-D6', 'Session : cookie HttpOnly/SameSite, révocation après logout', async () => {
    const lr = await fetch(new URL('/api/auth/login', url), {
      method: 'POST', headers: { origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ username: accounts.SALES2.username, password: accounts.SALES2.password }),
    });
    assert.equal(lr.status, 200);
    const setCookie = lr.headers.get('set-cookie') || '';
    assert.ok(/httponly/i.test(setCookie), 'cookie HttpOnly');
    assert.ok(/samesite=lax/i.test(setCookie), 'cookie SameSite=Lax');
    const cookie = setCookie.split(';')[0];
    const out = await fetch(new URL('/api/auth/logout', url), { method: 'POST', headers: { origin: url, cookie } });
    assert.equal(out.status, 200, 'logout');
    const after = await fetch(new URL('/api/orders', url), { headers: { origin: url, cookie } });
    assert.equal(after.status, 401, 'cookie révoqué après logout: ' + after.status);
  });
  await check('AUD-D7', 'Quatre-yeux : le créateur ne peut pas valider sa propre CMD', async () => {
    // Catalogue du produit fixé à 2000 MAD en tête de harnais : prix identique = pas d'exception tarifaire.
    const lines = [{ productId: matelasPrix.id, qty: 1, unitPrice: 2000, dimensions: { lengthCm: 90, widthCm: 190, heightCm: 20 } }];
    const o = (await createOrder('SALES_APPROVER', order(lines))).json.order;
    assert.equal(o.status, 'pending_validation', 'exception technique → validation');
    const self = await call('SALES_APPROVER', 'PATCH', `/api/orders/${o.id}`, { action: 'approve', comment: 'auto-validation' });
    assert.equal(self.status, 403, 'auto-validation interdite: ' + self.status);
    const other = await call('APPROVER', 'PATCH', `/api/orders/${o.id}`, { action: 'approve', comment: 'validation tiers' });
    assert.equal(other.status, 200, 'validateur tiers accepté: ' + other.status + ' ' + other.text.slice(0, 200));
  });

  /* ================= E. CSRF / origines ================= */
  await check('AUD-E1', 'Mutation sans en-tête Origin refusée (comptes nommés)', async () => {
    const r = await call('SALES', 'POST', '/api/orders', order([{ productId: matelasPrix.id, qty: 1, unitPrice: matelasPrix.unitPrice }]), { origin: 'none' });
    assert.equal(r.status, 403, 'origine requise: ' + r.status);
  });
  await check('AUD-E2', 'Mutation avec origine étrangère refusée', async () => {
    const r = await call('SALES', 'POST', '/api/orders', order([{ productId: matelasPrix.id, qty: 1, unitPrice: matelasPrix.unitPrice }]), { origin: 'http://attaquant.example' });
    assert.equal(r.status, 403, 'origine étrangère: ' + r.status);
  });
  await check('AUD-E3', 'Mutation inter-site (sec-fetch-site: cross-site) refusée', async () => {
    const r = await call('SALES', 'POST', '/api/orders', order([{ productId: matelasPrix.id, qty: 1, unitPrice: matelasPrix.unitPrice }]), { secFetchSite: 'cross-site' });
    assert.equal(r.status, 403, 'cross-site: ' + r.status);
  });

  /* ================= F. Injection & divulgation ================= */
  await check('AUD-F1', 'Paramètres de requête hostiles : aucun plantage ni SQL divulgué', async () => {
    for (const qs of ['?take=abc', '?take=999999999', "?skip=1;DROP--", '?take=-5']) {
      const r = await call('SALES', 'GET', '/api/orders' + qs);
      assert.ok([200, 400, 403].includes(r.status), `réponse inattendue ${r.status} pour ${qs}`);
      assert.ok(!/SQLITE|Prisma|SELECT |INSERT |node_modules/i.test(r.text), 'divulgation SQL/stack pour ' + qs);
    }
  });
  await check('AUD-F2', 'Corps malformés rejetés proprement (400, zod)', async () => {
    const r = await call('SALES', 'POST', '/api/orders', { clientId: '1 OR 1=1', lines: [{ productId: 'abc', qty: -1, unitPrice: 'NaN' }] });
    assert.equal(r.status, 400, 'zod doit rejeter: ' + r.status);
    const r2 = await call('SALES', 'POST', '/api/orders', null);
    assert.ok([400, 500].includes(r2.status));
    assert.ok(!/SQLITE|Prisma Client|node_modules/i.test(r2.text), 'pas de détails techniques');
  });

  /* ================= G. Financier ================= */
  let invAud;
  await check('AUD-G1', 'Flux complet CMD→BL→facture : double facturation impossible', async () => {
    const o = (await createApprovedOrder('SALES', order([{ productId: negoceB.id, qty: 5, unitPrice: negoceB.unitPrice }]))).json.order;
    // Préparation magasinier de l'OF de négoce (CMD → OF → BL, sans double sortie manuelle).
    await call('INVENTORY', 'PATCH', `/api/work-orders/${(await workOrders(o.id))[0].id}`, { action: 'prepare' });
    await call('SALES', 'POST', '/api/sales', { action: 'reserve-stock', orderId: o.id, orderLineId: o.lines[0].id, qty: 5 });
    const d = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, stockLines: [{ orderLineId: o.lines[0].id, qty: 5 }], requestKey: randomUUID() })).json.delivery;
    assert.ok(d && d.id, 'BL émis');
    const inv = (await call('FINANCE', 'POST', '/api/sales', { action: 'invoice', orderId: o.id, deliveryIds: [d.id], taxRateBps: 2000 })).json.invoice;
    assert.ok(inv && inv.id, 'facture émise');
    invAud = inv;
    const again = await call('FINANCE', 'POST', '/api/sales', { action: 'invoice', orderId: o.id, deliveryIds: [d.id], taxRateBps: 2000 });
    assert.equal(again.status, 409, 're-facturation du même BL refusée');
  });
  await check('AUD-G2', 'Sur-paiement séquentiel refusé (solde re-contrôlé)', async () => {
    const r = await call('FINANCE2', 'POST', '/api/sales', { action: 'payment', invoiceId: invAud.id, amountCents: invAud.totalCents, reference: 'AUD-PAY-1', method: 'virement' });
    assert.ok([200, 201].includes(r.status), 'paiement intégral: ' + r.status + ' ' + r.text.slice(0, 200));
    const over = await call('FINANCE2', 'POST', '/api/sales', { action: 'payment', invoiceId: invAud.id, amountCents: 100, reference: 'AUD-PAY-2', method: 'virement' });
    assert.equal(over.status, 409, 'paiement au-delà du solde refusé: ' + over.status);
  });
  let inv2Aud;
  await check('AUD-G3', 'Deux paiements CONCURRENTS du même montant : au plus un gagnant (CAS version)', async () => {
    const o = (await createApprovedOrder('SALES', order([{ productId: negoceB.id, qty: 6, unitPrice: negoceB.unitPrice }]))).json.order;
    await call('INVENTORY', 'PATCH', `/api/work-orders/${(await workOrders(o.id))[0].id}`, { action: 'prepare' });
    await call('SALES', 'POST', '/api/sales', { action: 'reserve-stock', orderId: o.id, orderLineId: o.lines[0].id, qty: 6 });
    const d = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, stockLines: [{ orderLineId: o.lines[0].id, qty: 6 }], requestKey: randomUUID() })).json.delivery;
    const inv = (await call('FINANCE', 'POST', '/api/sales', { action: 'invoice', orderId: o.id, deliveryIds: [d.id], taxRateBps: 0 })).json.invoice;
    inv2Aud = inv;
    const [p1, p2] = await Promise.all([
      call('FINANCE2', 'POST', '/api/sales', { action: 'payment', invoiceId: inv.id, amountCents: inv.totalCents, reference: 'AUD-CONC-A', method: 'virement' }),
      call('FINANCE2', 'POST', '/api/sales', { action: 'payment', invoiceId: inv.id, amountCents: inv.totalCents, reference: 'AUD-CONC-B', method: 'virement' }),
    ]);
    const ok = [p1, p2].filter(r => [200, 201].includes(r.status)).length;
    assert.equal(ok, 1, `un seul paiement concurrent doit passer (obtenu ${ok}) : [${p1.status},${p2.status}]`);
    const paid = one(`SELECT COALESCE(SUM(amountCents),0) s FROM SalesPayment WHERE invoiceId=?`, inv.id).s;
    assert.ok(paid <= inv.totalCents, `total payé (${paid}) ne dépasse pas la facture (${inv.totalCents})`);
  });
  await check('AUD-G4', 'Quatre-yeux financier : l\'émetteur de la facture ne peut pas l\'encaisser', async () => {
    const r = await call('FINANCE', 'POST', '/api/sales', { action: 'payment', invoiceId: inv2Aud.id, amountCents: 100, reference: 'AUD-SELF-PAY', method: 'virement' });
    assert.ok([403, 409].includes(r.status), 'paiement par l\'émetteur refusé: ' + r.status);
  });
  await check('AUD-G5', 'Avoir monétaire libre (sans retour ni ligne) : constat de la voie ouverte (P2-4)', async () => {
    // Facture NON soldée dédiée : la voie « avoir libre » (P2-4) se documente ici.
    // (Stock résiduel de la matière B après G1/G3 : quantité 1.)
    const o = (await createApprovedOrder('SALES', order([{ productId: negoceB.id, qty: 1, unitPrice: negoceB.unitPrice }]))).json.order;
    await call('INVENTORY', 'PATCH', `/api/work-orders/${(await workOrders(o.id))[0].id}`, { action: 'prepare' });
    await call('SALES', 'POST', '/api/sales', { action: 'reserve-stock', orderId: o.id, orderLineId: o.lines[0].id, qty: 1 });
    const d = (await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, stockLines: [{ orderLineId: o.lines[0].id, qty: 1 }], requestKey: randomUUID() })).json.delivery;
    const invL = (await call('FINANCE', 'POST', '/api/sales', { action: 'invoice', orderId: o.id, deliveryIds: [d.id], taxRateBps: 0 })).json.invoice;
    assert.ok(invL && invL.id, 'facture dédiée émise: ' + JSON.stringify(invL).slice(0, 150));
    // Ce test DOCUMENT le comportement actuel : avoir plafonné au solde, quatre-yeux
    // à l'approbation, mais sans rattachement documentaire obligatoire.
    const r = await call('FINANCE', 'POST', '/api/sales', { action: 'credit', invoiceId: invL.id, amountCents: 500, reason: 'Avoir de test sans retour physique' });
    if ([200, 201].includes(r.status)) {
      const ap = await call('FINANCE2', 'POST', '/api/sales', { action: 'approve-credit', creditId: r.json.credit.id });
      assert.ok([200, 201].includes(ap.status), 'approbation tiers: ' + ap.status);
      results.push({ id: 'AUD-G5b', title: 'Avoir libre approuvé par un tiers : voie confirmée (anomalie P2-4 documentée)', result: 'PASS' });
    } else {
      results.push({ id: 'AUD-G5b', title: 'Avoir libre désormais refusé : anomalie P2-4 corrigée', result: 'PASS' });
    }
    const over = await call('FINANCE', 'POST', '/api/sales', { action: 'credit', invoiceId: invL.id, amountCents: invL.totalCents + 100, reason: 'Avoir excessif audit' });
    assert.ok([400, 409].includes(over.status), 'avoir > solde refusé: ' + over.status);
  });

  /* ================= H. Stock négatif / sur-livraison ================= */
  await check('AUD-H1', 'Livraison au-delà du stock libre refusée, stock jamais négatif', async () => {
    const o = (await createApprovedOrder('SALES', order([{ productId: negoceB.id, qty: 2, unitPrice: negoceB.unitPrice }]))).json.order;
    await call('INVENTORY', 'PATCH', `/api/work-orders/${(await workOrders(o.id))[0].id}`, { action: 'prepare' });
    const r = await call('SALES', 'POST', '/api/sales', { action: 'delivery', orderId: o.id, stockLines: [{ orderLineId: o.lines[0].id, qty: 999999 }], requestKey: randomUUID() });
    assert.equal(r.status, 409, 'sur-livraison refusée: ' + r.status);
    const neg = one(`SELECT COUNT(*) c FROM Material WHERE stockQty < -1e-9`).c + one(`SELECT COUNT(*) c FROM StockLot WHERE qty < -1e-9`).c;
    assert.equal(neg, 0, 'aucun stock négatif en base');
  });
  await check('AUD-H2', 'Unicité BL réception (contrainte en base)', async () => {
    const idx = q(`PRAGMA index_list('GoodsReceipt')`).filter(i => i.origin === 'u');
    const cols = idx.flatMap(i => q(`PRAGMA index_info('${i.name}')`).map(c => c.name));
    assert.ok(cols.includes('supplierOrderId') && cols.includes('deliveryRef'), 'index unique (supplierOrderId, deliveryRef) présent');
  });

  /* ================= I. Immutabilité SQL (triggers) ================= */
  await check('AUD-I1', 'Factures clients immuables au niveau SQL (trigger)', async () => {
    let blocked = false;
    try { db.prepare('UPDATE SalesInvoice SET totalCents = totalCents + 1 WHERE id=?').run(invAud.id); }
    catch { blocked = true; }
    assert.ok(blocked, 'UPDATE SalesInvoice doit être ABORTé par le trigger d\'immutabilité');
  });
  await check('AUD-I2', 'Lignes de facture fournisseur immuables après approbation (trigger)', async () => {
    // Fixture SQL : facture fournisseur approuvée + une ligne (démo, copie jetable).
    const sid = one('SELECT MIN(id) s FROM Supplier').s;
    const olid = one('SELECT MIN(id) s FROM OrderLine').s;
    const inv = db.prepare(`INSERT INTO SupplierInvoice(supplierId,invoiceNumber,invoiceDate,currency,status,totalAmount,createdBy,createdAt,freightAmount,version)
      VALUES(?,?,datetime('now'),'MAD','approved',100,'audit',datetime('now'),0,1)`).run(sid, 'AUDIT-FRS-001');
    db.prepare(`INSERT INTO SupplierInvoiceLine(invoiceId,orderLineId,qty,unitPrice,taxRate) VALUES(?,?,?,?,0)`).run(Number(inv.lastInsertRowid), olid, 1, 10);
    let blocked = false;
    try { db.prepare('UPDATE SupplierInvoiceLine SET unitPrice = 0 WHERE invoiceId=?').run(Number(inv.lastInsertRowid)); }
    catch { blocked = true; }
    assert.ok(blocked, 'UPDATE SupplierInvoiceLine (facture approuvée) doit être ABORTé');
  });
  await check('AUD-I3', 'Historiques protégés contre la suppression physique (triggers)', async () => {
    for (const t of ['Order', 'OrderLine', 'Movement', 'StockLot', 'SalesInvoice', 'SupplierInvoice']) {
      let blocked = false;
      try { db.prepare(`DELETE FROM "${t}" WHERE id=(SELECT MIN(id) FROM "${t}")`).run(); }
      catch { blocked = true; }
      assert.ok(blocked, `DELETE ${t} doit être ABORTé`);
    }
  });
  await check('AUD-I4', 'Intégrité SQLite et clés étrangères intactes après tous les tests', async () => {
    assert.equal(one('PRAGMA integrity_check').integrity_check, 'ok');
    assert.equal(q('PRAGMA foreign_key_check').length, 0, 'aucune violation FK');
  });

  if (serverHandle) { try { process.kill(-serverHandle.pid, 'SIGKILL'); } catch {} }
  const failed = results.filter(r => r.result === 'FAIL');
  console.log('\n================ RÉSULTATS AUDIT ANTI-FUITES ================');
  for (const r of results) console.log(`${r.result === 'PASS' ? 'PASS' : 'FAIL'} ${r.id} : ${r.title}${r.detail ? ' → ' + r.detail : ''}`);
  console.log(`TOTAL : ${results.length - failed.length}/${results.length} PASS, ${failed.length} FAIL`);
  fs.writeFileSync(path.join(root, 'AUDIT_ANTI_FUITES_RESULTATS.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => {
  console.error('ERREUR HARNAIS :', e);
  if (serverHandle) { try { process.kill(-serverHandle.pid, 'SIGKILL'); } catch {} }
  process.exit(2);
});
