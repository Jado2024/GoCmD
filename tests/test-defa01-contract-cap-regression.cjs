'use strict';
/* P5.15.21 RC — DEF-A-01 : régression exécutable du plafond d'attribution
 * contractuelle. Un BC CONTRACT est plafonné à la quantité décidée dans une
 * consultation approuvée (garde CONTRACT_AWARD_REQUIRED à la création).
 * Le contre-audit final a montré que l'action « revision » (sourcing) puis
 * l'approbation laissaient augmenter la quantité au-delà du plafond : ce test
 * rejoue le contournement complet sur un serveur de production réel et une
 * base jetable, et exige le refus aux DEUX niveaux (révision ET approbation).
 * Le fixture d'attribution (contrat approuvé + plan attribué 60 u) est inséré
 * en SQL comme toute décision sourcing validée ; le reste passe par l'API. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {createServer}=require('node:net'),{tmpdir}=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {createAccounts,loginAccounts}=require('./qa-managed-accounts.cjs');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(tmpdir(),'gocmd-defa01-'));
const file=path.join(temp,'qa.db');fs.copyFileSync(path.join(root,'db/custom.db'),file);
const accounts=createAccounts(file,'dfa',{buyer:['buyer'],approver:['buyer','approver'],approver2:['approver']});
const db=new DatabaseSync(file);
let server,base,cookies;
async function api(role,method,url,body,allowed=[200,201]){
  const response=await fetch(base+url,{method,headers:{origin:base,cookie:cookies[role],'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  let data=null;try{data=await response.json()}catch{}
  return {status:response.status,data};
}
(async()=>{
  // ── Fixture : fournisseur actif qualifié + matière + liaison, contrat
  // approuvé (quatre yeux), DA approuvée, RFQ attribuée, plan approuvé avec
  // allocation contractuelle de 60 unités.
  const link=db.prepare(`SELECT s.id supplierId,m.id materialId,COALESCE(sm.unitPrice,m.unitPrice) price
    FROM SupplierMaterial sm JOIN Supplier s ON s.id=sm.supplierId JOIN Material m ON m.id=sm.materialId
    WHERE s.active=1 AND sm.unitsPerPurchase>0 ORDER BY s.id LIMIT 1`).get();
  assert(link,'liaison fournisseur/matière requise');
  db.exec('PRAGMA foreign_keys=ON');
  const now=Date.now();
  db.prepare(`INSERT INTO SupplierQualification(supplierId,status,score,note,reviewedBy,reviewedAt)
    VALUES(?,?,?,?,?,?)`).run(link.supplierId,'approved',95,'Fixture DEF-A-01','fixture_root',now);
  const agreement=db.prepare(`INSERT INTO SupplierPriceAgreement(supplierId,materialId,contractRef,documentRef,unitPrice,currency,validFrom,validUntil,status,createdBy,approvedBy,approvedAt,createdAt,priceBasis)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(link.supplierId,link.materialId,'CTR-DEFA01','PDF-CTR-DEFA01',Number(link.price),'MAD',now-86400000,now+365*86400000,'approved','fixture_buyer','fixture_approver',now,now,'STOCK');
  const da=db.prepare(`INSERT INTO PurchaseRequest(ref,status,createdBy,note,createdAt) VALUES(?,?,?,?,?)`).run('DA-DEFA01','approved','fixture_buyer','Fixture DEF-A-01',now);
  const daLine=db.prepare(`INSERT INTO PurchaseRequestLine(requestId,materialId,qty,unitPrice,receivedQty,approvedQty,approvalDecision) VALUES(?,?,?,?,?,?,'approved')`).run(da.lastInsertRowid,link.materialId,100,Number(link.price),0,100);
  const rfq=db.prepare(`INSERT INTO SupplierRFQ(ref,materialId,requestLineId,qty,unit,status,createdBy,createdAt) VALUES(?,?,?,?,?,?,?,?)`).run('RFQ-DEFA01',link.materialId,daLine.lastInsertRowid,100,'bloc','awarded','fixture_buyer',now);
  const plan=db.prepare(`INSERT INTO SupplierAwardPlan(rfqId,status,reason,proposedBy,proposedAt,decidedBy,decidedAt) VALUES(?,?,?,?,?,?,?)`).run(rfq.lastInsertRowid,'approved','Attribution contractuelle fixture','fixture_buyer',now,'fixture_approver',now);
  db.prepare(`INSERT INTO SupplierAwardContractAllocation(planId,agreementId,qty,unitPrice) VALUES(?,?,?,?)`).run(plan.lastInsertRowid,agreement.lastInsertRowid,60,Number(link.price));

  // ── Serveur de production réel
  const probe=createServer().listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  base='http://127.0.0.1:'+port;
  server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)],{cwd:root,env:{...process.env,GOCMD_DB_FILE:file,DATABASE_URL:'file:'+file,GOCMD_REQUIRE_SQLITE_USERS:'1',GOCMD_PUBLIC_ORIGIN:base},stdio:['ignore','pipe','pipe']});
  let output='';for(const stream of [server.stdout,server.stderr])stream.on('data',x=>output=(output+x).slice(-5000));
  for(let n=0;n<150;n++){assert(server.exitCode===null,output);try{if((await fetch(base+'/api/me')).status===401)break}catch{}assert(n<149);await new Promise(r=>setTimeout(r,200));}
  cookies=await loginAccounts(base,accounts);

  // 1. Création du BC contractuel dans le plafond (60/60) : acceptée.
  const created=await api('buyer','POST','/api/supplier-orders',{supplierId:link.supplierId,note:'DEF-A-01',lines:[{requestLineId:Number(daLine.lastInsertRowid),qty:60,unitPrice:Number(link.price),sourceType:'CONTRACT',sourceId:Number(agreement.lastInsertRowid)}]});
  assert.equal(created.status,201,`création BC contrat: ${JSON.stringify(created.data).slice(0,300)}`);
  const bcId=created.data.order.id;
  const bcLine=db.prepare('SELECT id FROM SupplierOrderLine WHERE orderId=?').get(bcId);

  // 2. CONTROLEMENT par révision : porter 60 → 100 doit être refusé (409 CONTRACT_AWARD_REQUIRED).
  const bypass=await api('approver','POST','/api/p2p/sourcing',{action:'revision',orderId:bcId,reason:'Contournement plafond contrat — refus attendu',lines:[{id:bcLine.id,qty:100,unitPrice:Number(link.price)}]},[409]);
  assert.equal(bypass.status,409,`révision au-delà du plafond doit être refusée: ${JSON.stringify(bypass.data).slice(0,300)}`);
  assert.equal(bypass.data.code,'CONTRACT_AWARD_REQUIRED','code CONTRACT_AWARD_REQUIRED attendu à la révision');
  assert.equal(db.prepare('SELECT qty FROM SupplierOrderLine WHERE id=?').get(bcLine.id).qty,60,'quantité inchangée après refus');

  // 3. Révision légitime (60 → 50, sous le plafond) : acceptée.
  const legit=await api('approver','POST','/api/p2p/sourcing',{action:'revision',orderId:bcId,reason:'Ajustement sous plafond — accepté',lines:[{id:bcLine.id,qty:50,unitPrice:Number(link.price)}]});
  assert.equal(legit.status,201,`révision légitime: ${JSON.stringify(legit.data).slice(0,300)}`);
  assert.equal(db.prepare('SELECT qty FROM SupplierOrderLine WHERE id=?').get(bcLine.id).qty,50);

  // 4. CONTROLEMENT direct (toute autre voie) : forcer la quantité en base
  // puis approuver doit être refusé à l'APPROBATION (garde de second niveau).
  db.prepare('UPDATE SupplierOrderLine SET qty=100, purchaseQty=100 WHERE id=?').run(bcLine.id);
  const approve=await api('approver2','PATCH',`/api/supplier-orders/${bcId}`,{action:'approve'},[409]);
  assert.equal(approve.status,409,`approbation au-delà du plafond doit être refusée: ${JSON.stringify(approve.data).slice(0,300)}`);
  assert.match(String(approve.data.error),/contrat|attribu/i,"message contractuel attendu");
  assert.equal(db.prepare('SELECT status FROM SupplierOrder WHERE id=?').get(bcId).status,'draft','BC non confirmé après refus');

  // 5. Retour à une quantité conforme : l'approbation doit réussir (contrôle négatif du garde).
  db.prepare('UPDATE SupplierOrderLine SET qty=60, purchaseQty=60 WHERE id=?').run(bcLine.id);
  const approved=await api('approver2','PATCH',`/api/supplier-orders/${bcId}`,{action:'approve'});
  assert.equal(approved.status,200,`approbation conforme: ${JSON.stringify(approved.data).slice(0,300)}`);
  assert.equal(db.prepare('SELECT status FROM SupplierOrder WHERE id=?').get(bcId).status,'confirmed');

  // 6. Deuxième BC contractuel au-delà du cumul (60 déjà engagés / 60 alloués) : refus à la création.
  const second=await api('buyer','POST','/api/supplier-orders',{supplierId:link.supplierId,note:'DEF-A-01 second',lines:[{requestLineId:Number(daLine.lastInsertRowid),qty:10,unitPrice:Number(link.price),sourceType:'CONTRACT',sourceId:Number(agreement.lastInsertRowid)}]},[409]);
  assert.equal(second.status,409);
  assert.equal(second.data.error&&/contrat|attribu/i.test(String(second.data.error)),true,'garde création toujours active');

  console.log('PASS DEF-A-01 : plafond contractuel re-vérifié à la révision ET à l\'approbation (contournement 60→100 refusé aux deux niveaux, révision légitime 60→50 acceptée, approbation conforme OK, garde création intacte)');
})().catch(e=>{console.error('FAIL DEF-A-01:',e.stack||e);process.exitCode=1}).finally(async()=>{
  if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill();await exited;}
  db.close();fs.rmSync(temp,{recursive:true,force:true});
});
