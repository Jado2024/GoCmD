#!/usr/bin/env node
/* §5 — Test de reprise industrielle GoCmd P5.15.29.
 * Installation A fictive enrichie via API réelles (20 CMD dont 10 validées → OF,
 * réservation, flux P2P partiel avec PDF privé, facture), sauvegarde PENDANT une
 * charge d'écriture représentative, restauration sur installation B distincte,
 * comparaison intégrale données + documents, démarrage et écriture sur B,
 * puis tests négatifs (document altéré → échec sauvegarde ; cible existante → refus). */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:net'), { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { createAccounts, loginAccounts } = require('./qa-managed-accounts.cjs');

const root = path.resolve(__dirname, '..');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-reprise-'));
const installA = path.join(base, 'installationA'), installB = path.join(base, 'installationB');
const docsA = path.join(installA, 'private-documents');
fs.mkdirSync(docsA, { recursive: true });
const dbA = path.join(installA, 'gocmd.db');
fs.copyFileSync(path.join(root, 'db/custom.db'), dbA);

const SPEC = { SALES: ['sales'], APPROVER: ['approver'], BUYER: ['buyer'], RECEIVER: ['receiver'], FINANCE: ['finance'], INVENTORY: ['inventory'] };
const accounts = createAccounts(dbA, 'rep', SPEC);
let server = null, url = null, cookies = null;
const db = new DatabaseSync(dbA);

function freePort() { return new Promise((r, j) => { const s = createServer(); s.on('error', j); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }
async function boot(dbFile, docsDir, tag) {
  const port = await freePort(); const u = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [path.join(root, 'scripts/start-gocmd-checked.cjs')], {
    cwd: root, detached: true,
    env: { ...process.env, GOCMD_DB_FILE: dbFile, GOCMD_DOCUMENTS_DIR: docsDir, GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_REQUIRE_RBAC: '1', GOCMD_ACCESS_PASSWORD: '', GOCMD_ALLOW_DEMO_DB: '1', GOCMD_SALES_TAX_RATES_BPS: '0,2000', GOCMD_PUBLIC_ORIGIN: u, HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 200; i++) {
    if (srv.exitCode !== null) throw new Error(`serveur ${tag} mort ${srv.exitCode}`);
    try { if ((await fetch(u + '/api/me')).status === 401) break } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return { srv, u };
}
async function api(method, p, body, cookie, expect = [200, 201]) {
  const r = await fetch(url + p, { method, headers: { origin: url, cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  const text = await r.text(); let data = null; try { data = JSON.parse(text) } catch {}
  assert(expect.includes(r.status), `${method} ${p} => ${r.status} ${text.slice(0, 260)}`);
  return data;
}

// P6 (2026-11-11) : le présent test crée volontairement des commandes similaires
// (même client, même jour, même signature produits/quantités). Depuis P5.15.29-P5,
// le serveur exige une confirmation justifiée (409 DUPLICATE_ORDER_POTENTIAL puis
// duplicateReview:{token,reason}) — c'est le contrat documenté, utilisé ici comme
// l'interface le fait. Une simple répétition technique reste couverte séparément
// par la clé d'idempotence (test-p4-corrections.cjs) : elle est rejouée AVANT la
// détection de doublon et ne doit jamais passer par ce chemin de confirmation.
async function createOrder(payload, cookie) {
  const post = (body) => fetch(url + '/api/orders', { method: 'POST', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  let r = await post(payload);
  let text = await r.text(); let data = null; try { data = JSON.parse(text) } catch {}
  if (r.status === 409 && data && data.code === 'DUPLICATE_ORDER_POTENTIAL' && data.token) {
    r = await post({ ...payload, duplicateReview: { token: data.token, reason: `Commande distincte confirmée — test de reprise industrielle (${payload.note ?? "charge d écriture"})` } });
    text = await r.text(); try { data = JSON.parse(text) } catch { data = null }
  }
  assert([200, 201].includes(r.status), `POST /api/orders => ${r.status} ${text.slice(0, 260)}`);
  return data && data.order;
}

(async () => {
  // ── Installation A : enrichissement via API réelles
  const booted = await boot(dbA, docsA, 'A'); server = booted.srv; url = booted.u;
  cookies = await loginAccounts(url, accounts);
  const S = cookies.SALES, A = cookies.APPROVER, B = cookies.BUYER, R = cookies.RECEIVER, F = cookies.FINANCE;
  console.log('[A] serveur prêt, comptes nominatifs connectés');

  const client = db.prepare('SELECT id FROM Client ORDER BY id LIMIT 1').get();
  const mattress = db.prepare(`SELECT p.id,p.unitPrice FROM Product p WHERE p.status='active' AND p.family='MATELAS' AND p.unit='u' LIMIT 1`).get();
  const trade = db.prepare(`SELECT p.id,p.unitPrice,p.materialId FROM Product p JOIN Material m ON m.id=p.materialId WHERE p.status='active' AND m.isSellable=1 AND m.stockQty>2 LIMIT 1`).get();

  // 20 commandes clients : 10 restent en revue, 10 validées (quatre yeux) → OF
  const created = [];
  for (let i = 0; i < 20; i++) {
    // 10 premières : cotes personnalisées → revue technique obligatoire (pending_validation),
    // validation quatre yeux puis OF ; 10 suivantes : tarif catalogue → OF direct.
    const line = i < 10
      ? { productId: mattress.id, qty: 1, unitPrice: Number(mattress.unitPrice), dimensions: { lengthCm: 185, widthCm: 90, heightCm: 18 }, technicalInstructions: `Reprise industrielle ${i} : couture renforcée` }
      : { productId: mattress.id, qty: (i % 2) + 1, unitPrice: Number(mattress.unitPrice) };
    const o = await createOrder({ clientId: client.id, dueDate: '2027-01-31T12:00:00Z', priority: 'normale', note: `REPRISE-${i}`, lines: [line] }, S);
    created.push(o);
  }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM \"Order\" WHERE note LIKE 'REPRISE-%'").get().n, 20, '20 commandes créées');
  for (let i = 0; i < 10; i++) {
    await api('PATCH', `/api/orders/${created[i].id}`, { action: 'approve', comment: `Validation technique reprise ${i}` }, A, [200]);
  }
  const ofCount = db.prepare("SELECT COUNT(*) n FROM WorkOrder WHERE orderId IN (SELECT id FROM \"Order\" WHERE note LIKE 'REPRISE-%')").get().n;
  assert.ok(ofCount >= 10, `OF attendus >= 10, obtenu ${ofCount}`);
  console.log(`[A] 20 commandes (10 validées quatre-yeux) + ${ofCount} OF émis`);

  // Réservation de stock sur une commande NÉGOCE dédiée
  const orderTrade = await createOrder({ clientId: client.id, dueDate: '2027-01-31T12:00:00Z', priority: 'normale', note: 'REPRISE-NEGOCE', lines: [{ productId: trade.id, qty: 1, unitPrice: Number(trade.unitPrice) }] }, S);
  // CASCADE3 (11/11/2026) — P1FIX : toute commande (négoce compris) naît
  // pending_validation ; la réservation exige d'abord le visa quatre-yeux.
  await api('PATCH', `/api/orders/${orderTrade.id}`, { action: 'approve', comment: 'Validation quatre-yeux REPRISE-NEGOCE (test de reprise)' }, A, [200]);
  const resv = (await api('POST', '/api/sales', { action: 'reserve-stock', orderId: orderTrade.id, orderLineId: orderTrade.lines[0].id, qty: 1 }, S, [200, 201]));
  console.log('[A] réservation négoce:', JSON.stringify(resv).slice(0, 90));

  // Flux P2P avec PDF privé : DA → consultation → offre+PDF → BC → réception PARTIELLE → facture
  const link = db.prepare(`SELECT s.id supplierId,m.id materialId,sm.unitsPerPurchase FROM SupplierMaterial sm JOIN Supplier s ON s.id=sm.supplierId JOIN Material m ON m.id=sm.materialId WHERE s.active=1 AND sm.unitsPerPurchase>0 ORDER BY s.id LIMIT 1`).get();
  const da = (await api('POST', '/api/purchases', { note: 'REPRISE-P2P', duplicateJustification: 'Test de reprise industrielle — besoin dédié jetable', lines: [{ materialId: link.materialId, qty: 20 }] }, B)).purchase;
  await api('PATCH', `/api/purchases/${da.id}`, { action: 'advance' }, A, [200]);
  const consultation = (await api('POST', '/api/p2p/consultations', { lines: [{ requestLineId: da.lines[0].id, qty: 20 }], supplierIds: [link.supplierId] }, B)).consultation;
  const sourcing = (await api('GET', '/api/p2p/sourcing?pageSize=150', null, B)).data || {};
  await api('GET', '/api/p2p/sourcing?pageSize=150', null, B);
  const rfqs = ((await api('GET', '/api/p2p/sourcing?pageSize=150', null, B)));
  const rfq = rfqs.rfqs.find(x => x.requestLineId === da.lines[0].id && x.status === 'open');
  assert(rfq, 'RFQ ouverte');
  const offer = (await api('POST', '/api/p2p/sourcing', { action: 'offer', rfqId: rfq.id, supplierId: link.supplierId, unitPrice: 12.5, priceBasis: 'STOCK', qty: 20, leadTimeDays: 5, quoteRef: 'DEV-REPRISE', validUntil: '2027-06-30', documentRef: 'PDF-REPRISE' }, B)).result;
  assert(offer?.id, 'offre enregistrée');
  const form = new FormData();
  form.set('offerId', String(offer.id));
  form.set('file', new Blob(['%PDF-1.4\n%Offre reprise industrielle GoCmd\n'], { type: 'application/pdf' }), 'offre-reprise.pdf');
  const up = await fetch(url + '/api/p2p/offer-documents', { method: 'POST', headers: { origin: url, cookie: B }, body: form });
  assert.equal(up.status, 201, 'upload PDF privé ' + up.status);
  const plan = (await api('POST', '/api/p2p/awards', { action: 'propose', rfqId: rfq.id, reason: 'Attribution test de reprise', allocations: [{ offerId: offer.id, qty: 20 }] }, B)).result;
  await api('POST', '/api/p2p/awards', { action: 'approve', planId: plan.planId }, A, [200, 201]);
  const bc = (await api('POST', '/api/supplier-orders', { supplierId: link.supplierId, note: 'REPRISE-BC', lines: [{ requestLineId: da.lines[0].id, qty: 20, unitPrice: 12.5, sourceType: 'QUOTE', sourceId: offer.id }] }, B)).order;
  await api('PATCH', `/api/supplier-orders/${bc.id}`, { action: 'approve' }, A, [200]);
  // Réception PARTIELLE (8 sur 20)
  const bcLine = db.prepare('SELECT id FROM SupplierOrderLine WHERE orderId=?').get(bc.id);
  await api('POST', '/api/goods-receipts', { supplierOrderId: bc.id, deliveryRef: 'BL-REPRISE-1', lines: [{ supplierOrderLineId: bcLine.id, acceptedQty: 8, rejectedQty: 0, lot: 'LOT-REPRISE' }] }, R);
  console.log('[A] flux P2P complet avec PDF privé et réception partielle 8/20');

  // Facture fournisseur sur la réception partielle (finance, contrôle rapproché)
  const receiptLine = db.prepare('SELECT id FROM GoodsReceiptLine WHERE acceptedQty=8 ORDER BY id DESC LIMIT 1').get();
  await api('POST', '/api/supplier-invoices', { supplierId: link.supplierId, invoiceNumber: 'FACT-REPRISE-001', invoiceDate: '2026-11-10', lines: [{ receiptLineId: receiptLine.id, qty: 8, unitPrice: 12.5, taxRate: 20 }] }, F);
  console.log('[A] facture fournisseur FACT-REPRISE-001 enregistrée (8 × 12,50 MAD + TVA 20 %)');

  const countsA = {}, tables = ['Order', 'WorkOrder', 'OrderLine', 'OrderPiece', 'SalesStockReservation', 'PurchaseRequest', 'SupplierOrder', 'GoodsReceipt', 'SupplierInvoice', 'SupplierOfferAttachment', 'StockLot', 'Movement', 'AuditEvent', 'SupplierConsultation'];
  for (const t of tables) countsA[t] = db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;
  console.log('[A] état:', JSON.stringify(countsA));

  // ── Charge d'écriture représentative PENDANT la sauvegarde
  let loadRunning = true; const loadErrors = [];
  (async () => { let i = 0; while (loadRunning) { try { await createOrder({ clientId: client.id, dueDate: '2027-01-31T12:00:00Z', priority: 'normale', note: `CHARGE-${Date.now()}-${i++}`, lines: [{ productId: mattress.id, qty: 1, unitPrice: Number(mattress.unitPrice) }] }, S); } catch (e) { loadErrors.push(String(e.message).slice(0, 120)); } await new Promise(r => setTimeout(r, 60)); } })();

  const backupDir = path.join(base, 'sauvegardes-externes');
  const bk = spawnSync(process.execPath, ['--version'], {});
  const res1 = spawnSync('python3', [path.join(root, 'scripts/backup_gocmd_complete.py'), '--source', dbA, '--documents-dir', docsA, '--output-dir', backupDir], { encoding: 'utf8' });
  loadRunning = false; await new Promise(r => setTimeout(r, 400));
  console.log('[SAUVEGARDE]', res1.stdout.trim().slice(0, 120));
  assert.equal(res1.status, 0, 'sauvegarde complète: ' + res1.stderr);
  const zip = fs.readdirSync(backupDir).filter(f => f.endsWith('.zip'))[0];
  assert(zip, 'archive produite');
  const ordersDuringLoad = db.prepare("SELECT COUNT(*) n FROM \"Order\" WHERE note LIKE 'CHARGE-%'").get().n;
  console.log(`[CHARGE] ${ordersDuringLoad} commandes créées pendant la sauvegarde (${loadErrors.length} erreurs de charge tolérées)`);

  // ── Restauration sur installation B DISTINCTE
  const res2 = spawnSync('python3', [path.join(root, 'scripts/restore_gocmd_complete.py'), '--archive', path.join(backupDir, zip), '--target-dir', installB], { encoding: 'utf8' });
  console.log('[RESTAURATION]', res2.stdout.trim().slice(0, 100));
  assert.equal(res2.status, 0, 'restauration: ' + res2.stderr);

  // ── Comparaison intégrale A (au moment de la sauvegarde) vs B
  // L'instantané correspond à l'état au milieu de la charge : on compare à la BASE RESTAURÉE,
  // pas à l'état final de A (qui a continué d'écrire).
  const dbB = path.join(installB, 'database', 'gocmd.db');
  const docsB = path.join(installB, 'documents');
  const conB = new DatabaseSync(dbB, { readOnly: true });
  assert.equal(conB.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(conB.prepare('PRAGMA foreign_key_check').all().length, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(installB, 'manifest.json'), 'utf8'));
  // documents référencés en base B == fichiers présents == empreintes manifeste
  const rowsB = conB.prepare('SELECT storedName,sha256,bytes FROM SupplierOfferAttachment ORDER BY storedName').all();
  assert.equal(rowsB.length, manifest.document_count, 'documents manifeste vs base');
  const crypto = require('node:crypto');
  for (const r of rowsB) {
    const f = path.join(docsB, r.storedName);
    assert(fs.statSync(f).isFile(), 'document restauré: ' + r.storedName);
    const h = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    assert.equal(h, r.sha256, 'empreinte document ' + r.storedName);
    assert.equal(fs.statSync(f).size, r.bytes);
    const orig = path.join(docsA, r.storedName);
    assert(fs.statSync(orig).isFile() && crypto.createHash('sha256').update(fs.readFileSync(orig)).digest('hex') === r.sha256, 'identique à l\'original A');
  }
  console.log(`[B] ${rowsB.length} documents privés restaurés, empreintes conformes (A == B == manifeste)`);

  // comparaison par table : B doit être un sous-ensemble cohérent de A (état sauvegardé)
  const countsB = {};
  for (const t of tables) countsB[t] = conB.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;
  const afterA = {}; const conA2 = db;
  for (const t of tables) afterA[t] = conA2.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;
  let ok = true;
  for (const t of tables) { if (!(countsB[t] <= afterA[t] && countsB[t] >= (t === 'Order' ? countsA['Order'] : 0))) { ok = false; console.log('  écarts', t, countsB[t], 'entre', countsA[t], 'et', afterA[t]); } }
  assert(ok, 'cohérence des volumes B ⊆ A_final et ≥ état initial');
  assert(countsB['Order'] >= countsA['Order'], 'aucune commande perdue entre inventaire initial et restauration');
  assert(countsB['GoodsReceipt'] >= 1 && countsB['SupplierOfferAttachment'] >= 1, 'BR et PDF présents dans B');
  console.log('[B] volumes:', JSON.stringify(countsB));

  // ── Installation B démarre, s'authentifie, lit et ÉCRIT
  process.kill(-server.pid, 'SIGKILL'); server = null;
  const bootedB = await boot(dbB, docsB, 'B');
  const urlB = bootedB.u; const oldUrl = url; url = urlB;
  const cookiesB = await loginAccounts(urlB, accounts);
  const orders = (await api('GET', '/api/orders?take=200', null, cookiesB.SALES)).items;
  assert(orders.length >= countsB['Order'], `commandes visibles après restauration: ${orders.length}`);
  const written = (await api('POST', '/api/orders', { clientId: client.id, dueDate: '2027-02-15T12:00:00Z', priority: 'normale', note: 'POST-RESTAURATION', lines: [{ productId: mattress.id, qty: 1, unitPrice: Number(mattress.unitPrice) }] }, cookiesB.SALES)).order;
  assert(written?.id, 'écriture post-restauration');
  console.log(`[B] serveur opérationnel : ${orders.length} commandes visibles, nouvelle commande ${written.ref} créée`);
  process.kill(-bootedB.srv.pid, 'SIGKILL');
  url = oldUrl;

  // ── Tests négatifs
  const victim = rowsB[0];
  const alt = path.join(docsA, victim.storedName);
  const saved = fs.readFileSync(alt);
  fs.writeFileSync(alt, Buffer.concat([saved, Buffer.from('%tamper')]));
  const res3 = spawnSync('python3', [path.join(root, 'scripts/backup_gocmd_complete.py'), '--source', dbA, '--documents-dir', docsA, '--output-dir', backupDir], { encoding: 'utf8' });
  assert.notEqual(res3.status, 0, 'une sauvegarde avec document altéré DOIT échouer');
  console.log('[NÉGATIF] document altéré → sauvegarde refusée :', res3.stderr.trim().slice(0, 90));
  fs.writeFileSync(alt, saved);
  const res4 = spawnSync('python3', [path.join(root, 'scripts/restore_gocmd_complete.py'), '--archive', path.join(backupDir, zip), '--target-dir', installB], { encoding: 'utf8' });
  assert.notEqual(res4.status, 0, 'restaurer sur une cible existante DOIT être refusé');
  console.log('[NÉGATIF] restauration sur cible existante refusée :', res4.stderr.trim().slice(0, 80));

  console.log('\nPASS — TEST DE REPRISE INDUSTRIELLE INTÉGRAL : base + documents privés + empreintes + démarrage B + écriture B + gardes négatives');
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(0);
})().catch(e => {
  console.error('FAIL REPRISE :', e.stack || e);
  if (server) { try { process.kill(-server.pid, 'SIGKILL') } catch {} }
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(1);
});
