#!/usr/bin/env node
/* R13.3 D-GEN-01 — non-régression de la correction « champs taxonomiques ».
 *
 * Défaut corrigé (option D de l'analyse D-GEN-01) : les fiches internes
 * INT-GEN créées par POST /api/orders pour les gabarits génériques ne
 * portaient AUCUN champ taxonomique ; le trigger V16 go_v16_product_insert
 * rejetait donc GEN-MAT (MATELAS) et GEN-MOU (PLAQUE_MOUSSE) par ABORT —
 * la commande entière échouait en 503 trompeur, et GEN-DIV (famille DIVERS
 * inconnue de la taxonomie) échouait de même.
 *
 * Correctif : le formulaire générique collecte désormais les caractéristiques
 * réelles, GenericLineSchema les valide AVANT insertion (400 explicites,
 * règles strictement alignées sur le trigger — aucun contournement), et la
 * fiche INT-GEN les persiste. GEN-DIV est refusé proprement (400) en
 * attendant la décision métier SODEPI (D-GEN-01/E) : la famille DIVERS ne
 * peut pas être ajoutée sans décision.
 *
 * Ce test rejoue les parcours réels sur une copie jetable de la base DEMO :
 *   1. GEN-SAL reste accepté (aucun champ taxonomique requis) ;
 *   2. GEN-MAT PURE avec champs complets → 201 et fiche INT-GEN conforme ;
 *   3. GEN-MAT MELANGE avec couches valides → 201 et foamLayers persisté ;
 *   4. GEN-MOU avec nature/densité/grade → 201 et fiche conforme ;
 *   5. GEN-MAT sans champs → 400 explicite (PLUS JAMAIS 503) ;
 *   6. GEN-MAT MELANGE dont les couches dépassent la hauteur → 400 ;
 *   7. GEN-DIV → 400 « suspendu » (décision métier), pas 503 ;
 *   8. cycle quatre-yeux complet sur une commande GEN-MAT (visa directeur
 *      avec mot de passe sensible + approbation indépendante) ;
 *   9. PRAGMA integrity_check + foreign_key_check à la fin.
 *
 * Usage : GOCMD_E2E_CONFIRM=ISOLATED_DB_ONLY node tests/r133-dgen01-generic-taxonomy.test.cjs
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
const temp = mkdtempSync(join(tmpdir(), 'gocmd-r133-dgen01-'));
const file = join(temp, 'dgen01.db');
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

  const login = async (name) => {
    const r = await fetch(url + '/api/auth/login', { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify(accounts[name]) });
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
  const client = (await api('sales0', 'GET', '/api/clients?take=5')).d.items[0];
  assert(client, 'client démo requis');

  let seq = 0;
  const create = async (generic, unitPrice = 850) => {
    // Pièces physiques : format des recettes validées (repro-corruption.cjs /
    // diag-create.cjs) — linearMeters pour les familles facturées au mètre
    // linéaire (GEN-SAL), count pour les familles à l'unité.
    const isMl = generic.template === 'GEN-SAL';
    const part = { label: generic.description.slice(0, 30), shape: 'rectangle', lengthCm: generic.lengthCm ?? 100, widthCm: generic.widthCm ?? 50, heightCm: generic.heightCm ?? 10, count: 1, ...(isMl ? { linearMeters: 8.5 } : {}) };
    const body = { clientId: client.id, dueDate: new Date(Date.now() + (30 + (seq % 200)) * 86400_000).toISOString(), priority: 'normale', note: `DGEN01-${seq++}`, lines: [{ productId: -1, qty: isMl ? 8.5 : 1, unitPrice, generic: { ...generic, requiresPreparation: true }, ...(generic.template === 'GEN-DIV' ? {} : { parts: [part] }) }] };
    let r = await api('sales0', 'POST', '/api/orders', body);
    if (r.status === 409 && r.d?.token) { body.duplicateReview = { token: r.d.token, reason: 'Test non-régression D-GEN-01 : commande de test confirmée' }; r = await api('sales0', 'POST', '/api/orders', body); }
    return r;
  };

  // 1. GEN-SAL reste accepté sans aucun champ taxonomique.
  const sal = await create({ template: 'GEN-SAL', description: 'Salon sur mesure recette D-GEN-01', specifications: 'Non-régression : aucun champ taxonomique requis pour SALON', lengthCm: 300, widthCm: 90, heightCm: 45 }, 950);
  assert.equal(sal.status, 201, `GEN-SAL doit rester créable : HTTP ${sal.status} ${JSON.stringify(sal.d).slice(0, 250)}`);

  // 2. GEN-MAT PURE avec champs complets → 201.
  const mat = await create({ template: 'GEN-MAT', description: 'Matelas sur mesure recette D-GEN-01', specifications: 'Correctif champs taxonomiques : noyau Bonnell, mousse pure 35 kg/m3', lengthCm: 190, widthCm: 90, heightCm: 25, coreType: 'BONNELL', foamComposition: 'PURE', mattressFinish: 'SANS', foamDensity: 35 });
  assert.equal(mat.status, 201, `GEN-MAT PURE doit aboutir : HTTP ${mat.status} ${JSON.stringify(mat.d).slice(0, 250)}`);
  assert(mat.d?.order?.id, 'commande GEN-MAT réellement créée obligatoire');

  // 3. GEN-MAT MELANGE avec deux couches valides (10+10 ≤ 25) → 201.
  const mix = await create({ template: 'GEN-MAT', description: 'Matelas mélange recette D-GEN-01', specifications: 'Mélange deux couches : pure 30 kg/m3 10 cm + agglo 22 kg/m3 10 cm', lengthCm: 190, widthCm: 90, heightCm: 25, coreType: 'SANS_RESSORTS', foamComposition: 'MELANGE', mattressFinish: 'TOPPER', foamLayers: [{ nature: 'PURE', densityKgM3: 30, thicknessCm: 10 }, { nature: 'AGGLO', densityKgM3: 22, thicknessCm: 10 }] });
  assert.equal(mix.status, 201, `GEN-MAT MELANGE doit aboutir : HTTP ${mix.status} ${JSON.stringify(mix.d).slice(0, 250)}`);

  // 4. GEN-MOU avec nature/densité/grade → 201.
  const mou = await create({ template: 'GEN-MOU', description: 'Plaque mousse spéciale recette', specifications: 'Plaque agglomérée 28 kg/m3 grade HR28 pour la recette D-GEN-01', lengthCm: 120, widthCm: 60, heightCm: 10, foamNature: 'AGGLO', foamDensity: 28, foamGrade: 'HR28' }, 420);
  assert.equal(mou.status, 201, `GEN-MOU doit aboutir : HTTP ${mou.status} ${JSON.stringify(mou.d).slice(0, 250)}`);

  // 5. GEN-MAT sans champs taxonomiques → 400 explicite (jamais 503).
  const missing = await create({ template: 'GEN-MAT', description: 'Matelas sans caractéristiques', specifications: 'Doit être refusé avant insertion : champs taxonomiques absents' });
  assert.equal(missing.status, 400, `GEN-MAT sans champs doit être 400, reçu ${missing.status} : ${JSON.stringify(missing.d).slice(0, 250)}`);
  assert(JSON.stringify(missing.d).includes('noyau') || JSON.stringify(missing.d).includes('GEN-MAT'), 'message d\'erreur explicite attendu');

  // 6. GEN-MAT MELANGE dont les couches dépassent la hauteur → 400.
  const thick = await create({ template: 'GEN-MAT', description: 'Matelas couches trop épaisses', specifications: 'Couches 20+20 cm sur matelas de 25 cm : refus attendu', lengthCm: 190, widthCm: 90, heightCm: 25, coreType: 'BONNELL', foamComposition: 'MELANGE', mattressFinish: 'SANS', foamLayers: [{ nature: 'PURE', densityKgM3: 30, thicknessCm: 20 }, { nature: 'AGGLO', densityKgM3: 22, thicknessCm: 20 }] });
  assert.equal(thick.status, 400, `couches > hauteur doit être 400, reçu ${thick.status}`);

  // 7. GEN-DIV → 400 « suspendu » (décision métier), jamais 503.
  const div = await create({ template: 'GEN-DIV', description: 'Divers à l unité recette', specifications: 'Famille DIVERS absente de la taxonomie : refus explicite attendu' });
  assert.equal(div.status, 400, `GEN-DIV doit être refusé en 400 (suspension documentée), reçu ${div.status} : ${JSON.stringify(div.d).slice(0, 250)}`);
  assert(JSON.stringify(div.d).includes('suspendu') || JSON.stringify(div.d).includes('DIVERS'), 'message de suspension attendu');

  // 8. Cycle quatre-yeux complet sur une commande GEN-MAT à prix hors catalogue.
  const visa = await create({ template: 'GEN-MAT', description: 'Matelas visa directeur D-GEN-01', specifications: 'Parcours complet : visa directeur puis approbation indépendante', lengthCm: 200, widthCm: 160, heightCm: 22, coreType: 'ENSACHES', foamComposition: 'PURE', mattressFinish: 'ALESE', foamDensity: 40 }, 1290);
  assert.equal(visa.status, 201, `commande visa GEN-MAT : HTTP ${visa.status} ${JSON.stringify(visa.d).slice(0, 250)}`);
  const line = visa.d.order.lines?.[0];
  assert(line?.id && line.priceApprovalStatus === 'pending', 'ligne GEN-MAT réellement soumise au visa directeur');
  const price = await api('dir0', 'PATCH', `/api/orders/${visa.d.order.id}`, { action: 'approve-prices', lineId: line.id, reason: 'Visa prix du test D-GEN-01', sensitivePassword: accounts.dir0.password });
  assert.equal(price.status, 200, `visa directeur GEN-MAT : HTTP ${price.status}`);
  const approve = await api('appr0', 'PATCH', `/api/orders/${visa.d.order.id}`, { action: 'approve', comment: 'Validation indépendante D-GEN-01' });
  assert.equal(approve.status, 200, `approbation quatre yeux GEN-MAT : HTTP ${approve.status}`);

  // 9. Vérification des fiches INT-GEN persistées + intégrité SQLite finale.
  const check = spawnSync(process.execPath, ['-e', `
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(${JSON.stringify(file)},{readOnly:true});
    const rows=db.prepare("SELECT model,family,coreType,foamComposition,mattressFinish,foamNature,foamDensity,foamGrade,foamLayers FROM Product WHERE isOrderScoped=1 ORDER BY id").all();
    const mat=rows.find(r=>r.model==='GEN-MAT'&&r.foamComposition==='PURE'&&r.foamDensity===35);
    if(!mat||mat.coreType!=='BONNELL'||mat.mattressFinish!=='SANS'||mat.foamNature!==null)throw Error('fiche GEN-MAT PURE non conforme: '+JSON.stringify(mat));
    const mix=rows.find(r=>r.model==='GEN-MAT'&&r.foamComposition==='MELANGE');
    if(!mix||!mix.foamLayers)throw Error('fiche GEN-MAT MELANGE sans couches');
    const layers=JSON.parse(mix.foamLayers);
    if(layers.length!==2||layers[0].nature!=='PURE'||layers[1].nature!=='AGGLO'||layers[0].densityKgM3!==30)throw Error('couches MELANGE non conformes: '+mix.foamLayers);
    if(mix.foamDensity!==null)throw Error('MELANGE ne doit pas porter de densité globale');
    const mou=rows.find(r=>r.model==='GEN-MOU');
    if(!mou||mou.foamNature!=='AGGLO'||mou.foamDensity!==28||mou.foamGrade!=='HR28'||mou.coreType!==null)throw Error('fiche GEN-MOU non conforme: '+JSON.stringify(mou));
    const div=rows.filter(r=>r.model==='GEN-DIV');
    if(div.length)throw Error('aucune fiche GEN-DIV ne doit exister (parcours suspendu)');
    const audits=db.prepare("SELECT COUNT(*) c FROM AuditEvent WHERE action='ORDER_GENERIC_TECHNICAL_RECORD_CREATED'").get().c;
    if(audits<5)throw Error('audits de création de fiches internes manquants: '+audits);
    const ic=db.prepare('PRAGMA integrity_check').get().integrity_check;
    if(ic!=='ok')throw Error('integrity_check='+ic);
    const fk=db.prepare('PRAGMA foreign_key_check').all();
    if(fk.length)throw Error('foreign_key_check='+fk.length+' violations');
    console.log('FICHES_OK mat PURE id#, MELANGE couches conformes, GEN-MOU conforme, 0 GEN-DIV, audits='+audits+', integrite=ok');`], { encoding: 'utf8' });
  assert.equal(check.status, 0, `vérification des fiches INT-GEN : ${(check.stdout || check.stderr || '').slice(0, 400)}`);
  console.log(check.stdout.trim());

  server.kill('SIGTERM');
  await sleep(1200);
  try { server.kill('SIGKILL'); } catch {}
  rmSync(temp, { recursive: true, force: true });
  console.log('PASS R13.3 D-GEN-01 : GEN-MAT/GEN-MOU insèrent leurs fiches INT-GEN conformes à la taxonomie V16 (champs réels saisis), GEN-DIV suspendu en 400 explicite, cycle quatre-yeux complet, intégrité SQLite ok.');
})().catch(e => { console.error('FAIL R13.3 D-GEN-01 :', e.message); try { server?.kill('SIGKILL'); } catch {} try { rmSync(temp, { recursive: true, force: true }); } catch {} process.exit(1); });
