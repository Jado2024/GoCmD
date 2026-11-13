#!/usr/bin/env node
/* Tests dédiés HTTP 409/503 sous concurrence R13 (mission §7).
 * Pour chaque niveau 2/5/10/20/50 utilisateurs simulés :
 *  - validations simultanées de la même commande (quatre yeux)
 *  - paiements simultanés de la même facture
 *  - réservations simultanées sur le même stock (dernière unité)
 *  - approbations simultanées du même document (BC)
 *  - requêtes identiques répétées (idempotence)
 *  - nouvelle tentative après échec
 * Journalise les codes HTTP observés (409 métier vs 5xx technique), les
 * erreurs SQLITE_BUSY/P1008/P2002 côté serveur, et vérifie les invariants
 * en base après chaque scénario (aucune double écriture). */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const directory = require('../src/lib/user-directory.cjs');
const {paymentRacePass, reservationRacePass, technicalErrors} = require('./r13-concurrency-invariants.cjs');
const root = path.resolve(__dirname, '..');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gocmd-conf409-'));
const file = path.join(temp, 'conf.db');
fs.copyFileSync(path.join(root, 'db/custom.db'), file);

const SPEC = {
  SALES: ['sales'], APPROVER: ['approver'], FINANCE_A: ['finance'], FINANCE_B: ['finance'],
  BUYER: ['buyer'], INVENTORY: ['inventory'],
};
const accounts = {};
{
  const admin = new DatabaseSync(file, {readOnly: true}).prepare('SELECT username FROM GoCmdUser WHERE is_root=1').get().username;
  const prev = process.env.GOCMD_DB_FILE;
  process.env.GOCMD_DB_FILE = file;
  for (const [name, roles] of Object.entries(SPEC)) {
    const username = 'conf_' + name.toLowerCase();
    const initial = randomBytes(24).toString('base64url');
    const password = randomBytes(24).toString('base64url');
    directory.createUser(admin, username, initial, roles, {});
    directory.changeOwnPassword(username, initial, password);
    accounts[name] = {username, password};
  }
  if (prev === undefined) delete process.env.GOCMD_DB_FILE; else process.env.GOCMD_DB_FILE = prev;
}
function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
let server, base, cookies = {}, srvLog = '';
const httpObservations = [];
const transportFailures = [];
const abort = () => { if (server && server.exitCode === null) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} } };
const results = [];
function record(id, pass, detail) {
  results.push({id, pass, detail});
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} : ${detail}`);
  if (!pass) process.exitCode = 1;
}
async function req(role, method, url, body, headers) {
  try {
    const r = await fetch(base + url, {method, headers: {origin: base, ...(cookies[role] ? {cookie: cookies[role]} : {}), ...(body ? {'content-type': 'application/json'} : {}), ...(headers ?? {})}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000)});
    const raw = await r.text();
    let data; try { data = JSON.parse(raw); } catch {}
    httpObservations.push({method, url, status: r.status});
    return {status: r.status, raw, data};
  } catch (error) {
    transportFailures.push({method, url, error: String(error)});
    throw error;
  }
}

(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/start-gocmd-checked.cjs'], {
    cwd: root,
    env: {...process.env, GOCMD_DB_FILE: file, GOCMD_REQUIRE_SQLITE_USERS: '1', GOCMD_REQUIRE_RBAC: '1',
      GOCMD_ACCESS_PASSWORD: '', GOCMD_ALLOW_DEMO_DB: '1', GOCMD_SALES_TAX_RATES_BPS: '0,2000',
      GOCMD_PUBLIC_ORIGIN: base, HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production'},
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const k of ['stdout', 'stderr']) server[k].on('data', d => { srvLog += d.toString(); });
  for (let i = 0; i < 140; i++) {
    if (server.exitCode !== null) throw new Error('serveur mort: ' + srvLog.slice(-1500));
    try { const r = await fetch(base + '/api/me', {signal: AbortSignal.timeout(1200)}); if (r.status === 401) break; } catch {}
    await new Promise(r => setTimeout(r, 350));
  }
  for (const [name, creds] of Object.entries(accounts)) {
    const r = await fetch(base + '/api/auth/login', {method: 'POST', headers: {origin: base, 'content-type': 'application/json'}, body: JSON.stringify(creds)});
    assert.equal(r.status, 200, 'login ' + name);
    cookies[name] = r.headers.get('set-cookie').split(';')[0];
  }
  const db = () => new DatabaseSync(file, {readOnly: true});

  // fixtures : client + produit
  const clients = await req('SALES', 'GET', '/api/clients');
  const clientId = clients.data.items?.[0]?.id ?? clients.data[0]?.id;
  const products = await req('SALES', 'GET', '/api/products?take=100');
  const items = products.data.items ?? products.data;
  const prod = items.find(p => p.family === 'BANQUETTE' && p.unit === 'ml') || items.find(p => p.status === 'active');

  let lastApprovedOrderId = null;
  for (const n of [2, 5, 10, 20, 50]) {
    // ——— C1 : validations simultanées de la même commande ———
    {
      // Quantité distincte par vague : la garde anti-doublon métier (même
      // client/produit/quantité le même jour) ne doit pas masquer le test
      // de concurrence ; chaque vague crée une commande réellement différente.
      const created = await req('SALES', 'POST', '/api/orders', {clientId, priority: 'normale', dueDate: '2027-01-31T00:00:00.000Z', lines: [{productId: prod.id, qty: 1 + n, unitPrice: Number(prod.unitPrice)}]});
      let oid = created.data.order?.id;
      if (created.status === 409 && (created.data.duplicate?.token || created.data.token)) {
        const token = created.data.duplicate?.token || created.data.token;
        const retry = await req('SALES', 'POST', '/api/orders', {clientId, priority: 'normale', dueDate: '2027-01-31T00:00:00.000Z', lines: [{productId: prod.id, qty: 1 + n, unitPrice: Number(prod.unitPrice)}], duplicateReview: {token, reason: 'Test concurrence vague ' + n + ' : commande volontairement distincte (quantité différente des précédentes vagues).'}});
        oid = retry.data.order?.id;
      }
      assert(oid, 'fixture C1: ' + created.raw.slice(0, 200));
      const shooters = Array.from({length: n}, () => req('APPROVER', 'PATCH', `/api/orders/${oid}`, {action: 'approve', comment: 'validation concurrence n=' + n}).catch(e => ({status: 0, raw: String(e)})));
      const rs = await Promise.all(shooters);
      const ok200 = rs.filter(r => r.status === 200).length;
      const conflict = rs.filter(r => r.status === 409).length;
      const d = db();
      const st = d.prepare('SELECT status, reviewedBy FROM "Order" WHERE id=?').get(oid);
      const audits = d.prepare("SELECT COUNT(*) c FROM AuditEvent WHERE action='CUSTOMER_ORDER_APPROVED' AND entityId=?").get(String(oid)).c;
      d.close();
      if (ok200 === 1 && st.status !== 'pending_validation') lastApprovedOrderId = oid;
      record(`C1-approbations-n${n}`, ok200 === 1 && conflict === n - 1 && audits === 1 && st.status !== 'pending_validation',
        `${n} validations // : 200×${ok200}, 409×${conflict}, audits=${audits}, statut=${st.status}`);
    }

    // ——— C2 : requêtes identiques répétées avec clé d'idempotence ———
    // La garde P5 (commande similaire même jour/client/lignes) est un comportement
    // métier : chaque vague utilise une signature distincte (quantité + date)
    // pour isoler le rejeu SIMULTANÉ de la même intention.
    {
      const key = 'conf409-' + n + '-' + randomBytes(5).toString('hex');
      const dueDate = `2027-0${1 + Math.floor(n / 10)}-2${n % 8}T00:00:00.000Z`;
      const body = {clientId, priority: 'normale', dueDate, lines: [{productId: prod.id, qty: 100 + n, unitPrice: Number(prod.unitPrice)}]};
      const rs = await Promise.all(Array.from({length: n}, () => req('SALES', 'POST', '/api/orders', body, {'Idempotency-Key': key}).catch(e => ({status: 0, raw: String(e)}))));
      const created201 = rs.filter(r => r.status === 201).length;
      const replayed200 = rs.filter(r => r.status === 200).length;
      const other = rs.filter(r => r.status !== 201 && r.status !== 200).map(r => r.status + ':' + (r.raw ?? '').slice(0, 80));
      const d = db();
      const cnt = d.prepare('SELECT COUNT(*) c FROM "Order" WHERE createRequestKey IS NOT NULL AND createRequestDigest IS NOT NULL').get().c;
      d.close();
      record(`C2-idempotence-n${n}`, created201 === 1 && created201 + replayed200 === n,
        `${n} requêtes même clé : 201×${created201}, 200-rejoué×${replayed200}${other.length ? ', autres=' + JSON.stringify(other.slice(0, 2)) : ''}, commandes idempotentes en base=${cnt}`);
    }

    // ——— C3 : lectures massives simultanées (aucune erreur 5xx attendue) ———
    {
      const rs = await Promise.all(Array.from({length: n}, () => req('SALES', 'GET', '/api/orders?view=list&take=50').catch(e => ({status: 0, raw: String(e)}))));
      const ok = rs.filter(r => r.status === 200).length;
      const s5xx = rs.filter(r => r.status >= 500).length;
      record(`C3-lectures-n${n}`, ok === n && s5xx === 0, `${n} lectures // : 200×${ok}, 5xx×${s5xx}`);
    }
  }

  // ——— C4 : paiements réellement concurrents d'une facture non réglée ———
  // La base DEMO est volontairement dépourvue de factures. On crée une fixture
  // financière RELATIONNELLEMENT complète sur notre copie jetable seulement :
  // commande approuvée C1 -> BL et ligne -> facture et ligne, sans paiement.
  // Le parcours métier de création de BL/facture est couvert séparément par HTTP ;
  // ici on isole la concurrence sur la route de paiement réelle.
  {
    assert(lastApprovedOrderId, 'fixture C4 : aucune commande approuvée C1');
    const d = new DatabaseSync(file);
    let invoiceId, totalCents;
    try {
      const order = d.prepare('SELECT id, clientId FROM "Order" WHERE id=?').get(lastApprovedOrderId);
      const line = d.prepare('SELECT id, qty, unit, unitPrice, productNameSnapshot, productSkuSnapshot FROM OrderLine WHERE orderId=? ORDER BY id LIMIT 1').get(lastApprovedOrderId);
      assert(order && line, 'fixture C4 : commande ou ligne absente');
      totalCents = Math.round(Number(line.unitPrice) * 100); // une unité de vente
      assert(Number.isSafeInteger(totalCents) && totalCents > 0, 'fixture C4 : prix invalide');
      const suffix = randomBytes(6).toString('hex');
      d.exec('BEGIN IMMEDIATE');
      const deliveryId = Number(d.prepare('INSERT INTO SalesDelivery (ref,orderId,createdBy) VALUES (?,?,?)')
        .run('BLC-CONF-' + suffix, order.id, accounts.SALES.username).lastInsertRowid);
      const deliveryLineId = Number(d.prepare('INSERT INTO SalesDeliveryLine (deliveryId,orderLineId,qty,unit,pieceIds,productNameSnapshot,productSkuSnapshot) VALUES (?,?,?,?,?,?,?)')
        .run(deliveryId, line.id, 1, line.unit, '[]', line.productNameSnapshot, line.productSkuSnapshot).lastInsertRowid);
      invoiceId = Number(d.prepare('INSERT INTO SalesInvoice (ref,orderId,clientId,status,subtotalCents,taxCents,totalCents,createdBy) VALUES (?,?,?,?,?,?,?,?)')
        .run('FAC-CONF-' + suffix, order.id, order.clientId, 'issued', totalCents, 0, totalCents, accounts.SALES.username).lastInsertRowid);
      d.prepare('INSERT INTO SalesInvoiceLine (invoiceId,deliveryLineId,qty,unit,unitPriceCents,amountCents,productNameSnapshot,productSkuSnapshot) VALUES (?,?,?,?,?,?,?,?)')
        .run(invoiceId, deliveryLineId, 1, line.unit, totalCents, totalCents, line.productNameSnapshot, line.productSkuSnapshot);
      d.exec('COMMIT');
    } catch (error) {
      try { d.exec('ROLLBACK'); } catch {}
      throw error;
    } finally { d.close(); }

    const suffix = randomBytes(6).toString('hex');
    const rs = await Promise.all([
      req('FINANCE_A', 'POST', '/api/sales', {action:'payment', invoiceId, amountCents:totalCents,reference:'CONF-PA-' + suffix,method:'virement'}).catch(e => ({status:0,raw:String(e)})),
      req('FINANCE_B', 'POST', '/api/sales', {action:'payment', invoiceId, amountCents:totalCents,reference:'CONF-PB-' + suffix,method:'virement'}).catch(e => ({status:0,raw:String(e)})),
    ]);
    const statuses = rs.map(r => r.status).sort((a,b) => a-b);
    const read = db();
    const pays = read.prepare('SELECT COUNT(*) c, COALESCE(SUM(amountCents),0) total FROM SalesPayment WHERE invoiceId=?').get(invoiceId);
    const inv = read.prepare('SELECT version,status,totalCents FROM SalesInvoice WHERE id=?').get(invoiceId);
    const auditCount = read.prepare("SELECT COUNT(*) c FROM AuditEvent WHERE action='SALES_PAYMENT_RECORDED' AND entity='SalesPayment' AND entityId IN (SELECT CAST(id AS TEXT) FROM SalesPayment WHERE invoiceId=?)").get(invoiceId).c;
    read.close();
    record('C4-paiements-simultanes', paymentRacePass({statuses,payments:pays,invoice:inv,totalCents,auditCount}),
      `facture=${invoiceId}, HTTP=${statuses}, paiements=${pays.c}, montant encaissé=${pays.total}/${totalCents}, version=${inv.version}, audits=${auditCount}`);
  }

  // ——— C5 : deux réservations disputent tout le stock disponible ———
  // Sélectionner une variante négoce avec unité de vente = unité physique,
  // et une capacité vérifiée en BDD. NE JAMAIS passer ce test sans requêtes.
  {
    const d = db();
    const candidate = d.prepare(`
      SELECT m.id materialId, p.id productId, p.unitPrice, p.unit,
        COALESCE(SUM(l.qty),0)-COALESCE((SELECT SUM(r.qty) FROM SalesStockReservation r JOIN StockLot s ON s.id=r.stockLotId WHERE s.materialId=m.id),0) free
      FROM Material m JOIN Product p ON p.materialId=m.id
      JOIN StockLot l ON l.materialId=m.id AND l.status='available' AND l.qty>0
      WHERE m.isSellable=1 AND p.status='active' AND p.unit=m.unit AND p.unitsPerSale=1
        AND l.expiresAt IS NULL
      GROUP BY m.id,p.id
      HAVING free>=1 AND CAST(free AS INT)=free
      ORDER BY free ASC LIMIT 1`).get();
    d.close();
    assert(candidate, 'fixture C5 : aucun négoce disponible en unité de stock 1:1');
    const qty = Number(candidate.free);
    const dueDates = ['2027-03-31T00:00:00.000Z','2027-04-30T00:00:00.000Z'];
    const ids = [];
    for (const dueDate of dueDates) {
      const payload = {clientId,priority:'normale',dueDate,lines:[{productId:candidate.productId,qty,unitPrice:Number(candidate.unitPrice)}]};
      let created = await req('SALES','POST','/api/orders',payload);
      if (created.status === 409 && (created.data?.duplicate?.token || created.data?.token)) {
        const token = created.data.duplicate?.token || created.data.token;
        created = await req('SALES','POST','/api/orders',{...payload,duplicateReview:{token,reason:'Deux commandes de recette distinctes, destinées au test de stock concurrent.'}});
      }
      assert.equal(created.status,201,'fixture C5 commande: '+created.raw.slice(0,200));
      const oid = created.data.order?.id;
      assert(oid,'fixture C5 : identifiant commande absent');
      const approval = await req('APPROVER','PATCH',`/api/orders/${oid}`,{action:'approve',comment:'Validation indépendante — test concurrence réservations'});
      assert.equal(approval.status,200,'fixture C5 approbation: '+approval.raw.slice(0,200));
      ids.push(oid);
    }
    const [first, second] = await Promise.all(ids.map(oid => req('SALES','GET',`/api/orders/${oid}`)));
    assert.equal(first.status,200,'fixture C5 détail 1');
    assert.equal(second.status,200,'fixture C5 détail 2');
    const line1 = first.data.order?.lines?.find(l => l.productId === candidate.productId);
    const line2 = second.data.order?.lines?.find(l => l.productId === candidate.productId);
    assert(line1?.id && line2?.id && line1.id !== line2.id, 'fixture C5 : identifiants de lignes indépendantes obligatoires');
    const rs = await Promise.all([
      req('SALES','POST','/api/sales',{action:'reserve-stock',orderId:ids[0],orderLineId:line1.id,qty}).catch(e => ({status:0,raw:String(e)})),
      req('SALES','POST','/api/sales',{action:'reserve-stock',orderId:ids[1],orderLineId:line2.id,qty}).catch(e => ({status:0,raw:String(e)})),
    ]);
    const statuses = rs.map(r => r.status).sort((a,b) => a-b);
    const dd = db();
    const reservations = dd.prepare(`SELECT r.orderLineId, SUM(r.qty) qty FROM SalesStockReservation r
      JOIN StockLot l ON l.id=r.stockLotId WHERE l.materialId=? GROUP BY r.orderLineId ORDER BY r.orderLineId`).all(candidate.materialId);
    const physical = dd.prepare("SELECT COALESCE(SUM(qty),0) s FROM StockLot WHERE materialId=? AND status='available'").get(candidate.materialId).s;
    const reserved = reservations.reduce((total,r) => total + Number(r.qty),0);
    dd.close();
    record('C5-reservations-derniere-unite', reservationRacePass({statuses,reservations,qty,physical,lineIds:[line1.id,line2.id]}),
      `lignes distinctes=${line1.id}/${line2.id}, stock=${qty}, HTTP=${statuses}, lignes réservées=${reservations.length}, total réservé=${reserved}, physique=${physical}`);
  }

  // ——— C6 : tentatives après échec (retry après 409 métier) ———
  {
    const key = 'conf409-retry-' + randomBytes(5).toString('hex');
    const body = {clientId, priority: 'normale', dueDate: '2027-05-31T00:00:00.000Z', lines: [{productId: prod.id, qty: 1, unitPrice: Number(prod.unitPrice)}]};
    const r1 = await req('SALES', 'POST', '/api/orders', body, {'Idempotency-Key': key});
    const r2 = await req('SALES', 'POST', '/api/orders', {...body, lines: [{...body.lines[0], qty: 3}]}, {'Idempotency-Key': key});
    const r3 = await req('SALES', 'POST', '/api/orders', body, {'Idempotency-Key': key});
    record('C6-retry-apres-echec', r1.status === 201 && r2.status === 409 && r3.status === 200,
      `retry : création 201, corps différent 409, rejeu identique 200 → ${r1.status}/${r2.status}/${r3.status}`);
  }

  // ——— C7 : les erreurs techniques DOIVENT faire échouer la campagne ———
  {
    const verdict = technicalErrors({serverLog:srvLog,httpObservations,transportFailures});
    record('C7-erreurs-techniques', verdict.pass,
      `signaux serveur=${verdict.signals.length ? verdict.signals.join(',') : 'aucun'}, réponses HTTP 5xx=${verdict.http5xx.length}, erreurs transport=${verdict.failures}`);
  }

  // ——— C8 : intégrité finale ———
  {
    const d = db();
    const integ = d.prepare('PRAGMA integrity_check').get().integrity_check;
    const fk = d.prepare('PRAGMA foreign_key_check').all().length;
    const dupRefs = d.prepare('SELECT COUNT(*) c FROM (SELECT ref FROM "Order" GROUP BY ref HAVING COUNT(*)>1)').get().c;
    d.close();
    record('C8-integrite-finale', integ === 'ok' && fk === 0 && dupRefs === 0, `integrity=${integ}, fk=${fk}, refs dupliquées=${dupRefs}`);
  }

  const passed = results.filter(r => r.pass).length;
  console.log(`TESTS 409/503 : ${passed}/${results.length} scénarios PASS`);
  if (process.env.GOCMD_QA_ARTIFACTS) {
    fs.mkdirSync(process.env.GOCMD_QA_ARTIFACTS, {recursive: true});
    fs.writeFileSync(path.join(process.env.GOCMD_QA_ARTIFACTS, 'tests-409-503-r13.json'), JSON.stringify(results, null, 2));
  }
})().catch(e => { console.error('FAIL tests 409/503:', e.stack || e); process.exitCode = 1; }).finally(() => { abort(); try { fs.rmSync(temp, {recursive: true, force: true}); } catch {} });
