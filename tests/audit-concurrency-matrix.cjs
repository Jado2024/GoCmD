'use strict';
/* P5.15.21 RC — Audit final CONC-001 : matrice de concurrence exhaustive.
 * Base jetable obligatoire (copie de db/custom.db en tmpdir). Trois serveurs
 * Next.js de production réels (processus indépendants), comptes managés
 * multi-sessions, scénarios :
 *  S1–S4 : 2 / 5 / 12 / 25 créations de commandes simultanées (réparties
 *          sur 3 processus) → références uniques, aucune erreur intermittente.
 *  S5    : répétition de la même requête (corps identique) 10× en parallèle.
 *  S6    : deux réservations simultanées de la dernière unité disponible.
 *  S7    : double approbation simultanée d'une même DA.
 *  S8    : double création simultanée de BC sur le même devis attribué.
 *  S9    : double réception simultanée du même BL.
 *  S10   : double approbation simultanée du même BC.
 *  S11   : interruption brutale (SIGKILL) d'un processus en pleine écriture,
 *          puis contrôle intégrité + écritures partielles + reprise.
 * NEVER run against a live SODEPI database. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {createServer}=require('node:net'),{tmpdir}=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {createAccounts,loginAccounts}=require('./qa-managed-accounts.cjs');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(tmpdir(),'gocmd-conc-matrix-'));
const file=path.join(temp,'qa.db');fs.copyFileSync(path.join(root,'db/custom.db'),file);
const accounts=createAccounts(file,'cmx',{
  sales:['sales'],buyer:['buyer'],approver:['approver'],receiver:['receiver'],inventory:['inventory']
});
const db=new DatabaseSync(file),servers=[],sessions=[],origins=[],instanceOutputs=[];
const report=[];function note(scenario,result,detail){report.push({scenario,result,detail});console.log(`${result?'PASS':'FAIL'} [${scenario}] ${detail}`)}
async function api(instance,role,method,url,body,allowed=[200,201]){
  const response=await fetch(origins[instance]+url,{method,headers:{origin:origins[instance],cookie:sessions[instance][role],'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  let data=null;try{data=await response.json()}catch{}
  return {status:response.status,data};
}
async function must(instance,role,method,url,body,allowed=[200,201]){
  const r=await api(instance,role,method,url,body,allowed);
  assert(allowed.includes(r.status),`${method} ${url} => ${r.status} ${JSON.stringify(r.data).slice(0,300)}`);
  return r;
}
async function startInstance(){
  const probe=createServer().listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const base='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)],{cwd:root,env:{...process.env,GOCMD_DB_FILE:file,DATABASE_URL:'file:'+file,GOCMD_REQUIRE_SQLITE_USERS:'1',GOCMD_PUBLIC_ORIGIN:base},stdio:['ignore','pipe','pipe']});
  servers.push(server);const instanceOutput={text:''};instanceOutputs.push(instanceOutput);
  for(const stream of [server.stdout,server.stderr])stream.on('data',x=>{instanceOutput.text=(instanceOutput.text+x.toString()).slice(-6000)});
  const output=instanceOutput.text;
  for(let n=0;n<150;n++){assert(server.exitCode===null,output);try{if((await fetch(base+'/api/me')).status===401)break}catch{}assert(n<149);await new Promise(r=>setTimeout(r,200));}
  origins.push(base);
  sessions.push(await loginAccounts(base,accounts));
  return servers.length-1;
}
async function parallelOrders(count,identicalBody,dayBase=1){
  const client=db.prepare('SELECT id FROM Client ORDER BY id LIMIT 1').get();
  const product=db.prepare(`SELECT p.id,p.unitPrice FROM Product p WHERE p.status='active' AND p.unit='u' AND p.materialId IS NULL LIMIT 1`).get();
  assert(product,'produit fini actif requis');
  // P6 (2026-11-11) : depuis P5.15.29-P5, deux commandes similaires (même client,
  // même jour de livraison, même signature produits/quantités) exigent une
  // confirmation justifiée — la note n'a jamais fait partie de la signature.
  // Pour tester l'allocation concurrente de références (intention d'origine de
  // S1–S4), chaque commande reçoit un jour de livraison distinct : ce ne sont
  // PAS des doublons commerciaux. Le cas « corps identique » (S5) est couvert
  // par le contrat P5 : exactement une création, refus 409 justifiés ailleurs.
  const body={clientId:client.id,priority:'normale',lines:[{productId:product.id,qty:1,unitPrice:Number(product.unitPrice)}]};
  const results=await Promise.allSettled(Array.from({length:count},(_,i)=>api(i%3,'sales','POST','/api/orders',
    identicalBody
      ?{...body,dueDate:'2027-04-30T12:00:00Z',note:'CORPS-IDENTIQUE-REPETE'}
      :{...body,dueDate:new Date(Date.now()+(dayBase+i)*864e5).toISOString(),note:`CONC-${count}-${Date.now()}-${i}`})));
  const out=results.map(r=>r.status==='fulfilled'?r.value:{status:0, data:{error:String(r.reason).slice(0,200)}});
  // P6 diagnostic : afficher le code d'erreur de chaque réponse non-201.
  for(const x of out)if(x.status!==201)console.log(`  [diag] status=${x.status} code=${x.data&&x.data.code} err=${String(x.data&&x.data.error).slice(0,120)}`);
  return out;
}
(async()=>{
  // ── Trois processus Next.js indépendants, tous connectés à la même base jetable.
  await startInstance();await startInstance();await startInstance();
  note('BOOT',true,'3 instances Next.js indépendantes démarrées, 5 comptes × 3 sessions authentifiées');
  const beforeOrders=db.prepare('SELECT count(*) n FROM "Order"').get().n;

  // S1 : 2 créations simultanées
  let r=await parallelOrders(2,false,1);note('S1-2-paralleles',r.every(x=>x.status===201)&&new Set(r.map(x=>x.data?.order?.ref)).size===2,`${r.map(x=>x.status).join(',')} — refs uniques ${new Set(r.map(x=>x.data?.order?.ref)).size}/2`);
  // S2 : 5 créations simultanées
  r=await parallelOrders(5,false,10);note('S2-5-paralleles',r.every(x=>x.status===201)&&new Set(r.map(x=>x.data?.order?.ref)).size===5,`${r.map(x=>x.status).join(',')} — refs uniques ${new Set(r.map(x=>x.data?.order?.ref)).size}/5`);
  // S3 : 12 créations simultanées
  r=await parallelOrders(12,false,30);note('S3-12-paralleles',r.every(x=>x.status===201)&&new Set(r.map(x=>x.data?.order?.ref)).size===12,`${r.map(x=>x.status).join(',')} — refs uniques ${new Set(r.map(x=>x.data?.order?.ref)).size}/12`);
  // S4 : 25 créations simultanées réparties sur 3 processus
  r=await parallelOrders(25,false,60);note('S4-25-paralleles',r.every(x=>x.status===201)&&new Set(r.map(x=>x.data?.order?.ref)).size===25,`${r.map(x=>x.status).join(',')} — refs uniques ${new Set(r.map(x=>x.data?.order?.ref)).size}/25`);
  // S5 : répétition de la même requête (corps strictement identique) ×10.
  // P6 (2026-11-11) — contrat P5.15.29-P5 : sans jeton de revue, exactement
  // UNE création passe et les 9 autres sont refusées 409 DUPLICATE_ORDER_POTENTIAL.
  // Le contrôle serveur, dans la transaction, n'est pas contournable par
  // concurrence ; aucune écriture partielle, aucune référence dupliquée.
  {
    const beforeS5=db.prepare('SELECT count(*) n FROM "Order"').get().n;
    r=await parallelOrders(10,true);
    const okS5=r.filter(x=>x.status===201),dupS5=r.filter(x=>x.status===409&&x.data&&x.data.code==='DUPLICATE_ORDER_POTENTIAL');
    const afterS5=db.prepare('SELECT count(*) n FROM "Order"').get().n;
    const partialS5=db.prepare(`SELECT count(*) n FROM "Order" o WHERE NOT EXISTS (SELECT 1 FROM OrderLine l WHERE l.orderId=o.id)`).get().n;
    note('S5-requete-repetee',okS5.length===1&&dupS5.length===9&&afterS5-beforeS5===1&&partialS5===0&&new Set(okS5.map(x=>x.data?.order?.ref)).size===1,`10 requêtes identiques → ${okS5.length} création (garde P5), ${dupS5.length} refus 409 justifiés, aucune écriture partielle`);
  }

  // S6 : deux réservations simultanées de la dernière unité disponible
  {
    const product=db.prepare(`SELECT p.id,p.unitPrice,p.materialId FROM Product p JOIN Material m ON m.id=p.materialId
      WHERE p.status='active' AND p.unitsPerSale=1 AND m.unit='bloc' AND m.stockQty>1 AND m.isSellable=1
      AND (SELECT count(*) FROM StockLot l WHERE l.materialId=m.id AND l.status='available' AND l.qty>0)=1 LIMIT 1`).get();
    assert(product,'fixture bloc négoce');
    const lot=db.prepare("SELECT id,qty FROM StockLot WHERE materialId=? AND status='available' AND qty>0").get(product.materialId);
    await must(0,'inventory','POST','/api/movements',{type:'out',materialId:product.materialId,stockLotId:lot.id,qty:lot.qty-1,reason:'Fixture dernière unité — matrice concurrence'});
    const client=db.prepare('SELECT id FROM Client ORDER BY id LIMIT 1').get();
    const seed={clientId:client.id,priority:'normale',lines:[{productId:product.id,qty:1,unitPrice:Number(product.unitPrice)}]};
    // P6 : jours de livraison distincts — la garde doublons P5 ne doit pas
    // bloquer deux commandes distinctes qui convoitent la même unité physique.
    const orders=[];for(const i of [0,1])orders.push((await must(i,'sales','POST','/api/orders',{...seed,dueDate:new Date(Date.now()+(3+i)*864e5).toISOString(),note:'RESERV-DERNIERE-UNITE-'+i})).data.order);
    // CASCADE3 (11/11/2026) — P1FIX : toute commande naît pending_validation et
    // aucune réservation n'est possible avant le visa commercial quatre-yeux.
    // Vérifié AUSSI négativement ici : la réservation AVANT approbation doit
    // être refusée (l'invariant P1FIX est couvert par la matrice elle-même).
    const premature=await api(0,'sales','POST','/api/sales',{action:'reserve-stock',orderId:orders[0].id,orderLineId:orders[0].lines[0].id,qty:1},[200,201,409]);
    const prematureRefused=premature.status===409;
    for(const i of [0,1])await must(i,'approver','PATCH',`/api/orders/${orders[i].id}`,{action:'approve',comment:`Validation réservation dernière unité ${i} — matrice concurrence`});
    const reserves=await Promise.all([api(0,'sales','POST','/api/sales',{action:'reserve-stock',orderId:orders[0].id,orderLineId:orders[0].lines[0].id,qty:1}),api(2,'sales','POST','/api/sales',{action:'reserve-stock',orderId:orders[1].id,orderLineId:orders[1].lines[0].id,qty:1})]);
    const ok200=reserves.filter(x=>x.status===200).length,ok409=reserves.filter(x=>x.status===409).length;
    const sum=db.prepare('SELECT sum(qty) n FROM SalesStockReservation WHERE stockLotId=?').get(lot.id).n;
    const qty=db.prepare('SELECT qty FROM StockLot WHERE id=?').get(lot.id).qty;
    note('S6-reservation-derniere-unite',ok200===1&&ok409===1&&sum===1&&qty===1&&prematureRefused,`[${reserves.map(x=>x.status).join(',')}] — somme réservations=${sum}, stock lot=${qty}, réservation pré-approbation refusée=${prematureRefused}`);
  }

  // Circuit P2P complet pour S7/S8/S9/S10
  {
    const link=db.prepare(`SELECT s.id supplierId,m.id materialId,m.unitPrice price FROM SupplierMaterial sm
      JOIN Supplier s ON s.id=sm.supplierId JOIN Material m ON m.id=sm.materialId
      WHERE s.active=1 AND sm.unitsPerPurchase>0 ORDER BY s.id LIMIT 1`).get();
    assert(link,'liaison fournisseur/matière requise');
    const token=`CMX-${Date.now()}`;
    // S7 : double approbation simultanée d'une même DA
    const da=(await must(0,'buyer','POST','/api/purchases',{note:token,duplicateJustification:`Matrice concurrence ${token} : besoin dédié jetable`,lines:[{materialId:link.materialId,qty:10}]})).data.purchase;
    const advances=await Promise.all([api(0,'approver','PATCH',`/api/purchases/${da.id}`,{action:'advance'}),api(1,'approver','PATCH',`/api/purchases/${da.id}`,{action:'advance'})]);
    note('S7-double-approbation-DA',advances.filter(x=>x.status===200).length===1&&advances.filter(x=>x.status===409).length===1,`[${advances.map(x=>x.status).join(',')}] — statut DA final=${db.prepare('SELECT status FROM PurchaseRequest WHERE id=?').get(da.id).status}`);
    const requestLine=da.lines[0].id;
    // Sourcing : consultation → devis écrit → PDF → attribution (quatre yeux)
    const consultation=(await must(0,'buyer','POST','/api/p2p/consultations',{lines:[{requestLineId:requestLine,qty:10}],supplierIds:[link.supplierId]})).data.consultation;
    assert(consultation?.id,'consultation créée');
    const sourcing=(await must(0,'buyer','GET','/api/p2p/sourcing?pageSize=150')).data;
    const rfq=sourcing.rfqs.find(x=>x.requestLineId===requestLine&&x.status==='open');assert(rfq,'RFQ ouverte');
    const offer=(await must(1,'buyer','POST','/api/p2p/sourcing',{action:'offer',rfqId:rfq.id,supplierId:link.supplierId,unitPrice:Math.max(0.01,Number(link.price)),priceBasis:'STOCK',qty:10,leadTimeDays:5,quoteRef:`DEV-${token}`,validUntil:new Date(Date.now()+30*864e5).toISOString().slice(0,10),documentRef:`PDF-DEV-${token}`})).data.result;
    assert(offer?.id,'offre enregistrée');
    const form=new FormData();form.set('offerId',String(offer.id));
    form.set('file',new Blob(['%PDF-1.4\n%Matrice concurrence GoCmd\n'],{type:'application/pdf'}),`dev-${token}.pdf`);
    const up=await fetch(origins[2]+'/api/p2p/offer-documents',{method:'POST',headers:{origin:origins[2],cookie:sessions[2].buyer},body:form});
    assert.equal(up.status,201,`upload PDF ${up.status}`);
    const plan=(await must(0,'buyer','POST','/api/p2p/awards',{action:'propose',rfqId:rfq.id,reason:`Attribution matrice concurrence ${token}`,allocations:[{offerId:offer.id,qty:10}]})).data.result;
    await must(1,'approver','POST','/api/p2p/awards',{action:'approve',planId:plan.planId});
    // S8 : double création simultanée de BC sur le même devis attribué (quantité totale = quantité offerte)
    const bcBody={supplierId:link.supplierId,note:token,lines:[{requestLineId:requestLine,qty:10,unitPrice:Math.max(0.01,Number(link.price)),sourceType:'QUOTE',sourceId:offer.id}]};
    const bcs=await Promise.all([api(0,'buyer','POST','/api/supplier-orders',bcBody),api(2,'buyer','POST','/api/supplier-orders',bcBody)]);
    const engaged=db.prepare(`SELECT count(*) n, coalesce(sum(qty),0) q FROM SupplierOrderLine WHERE priceSourceType='QUOTE' AND priceSourceId=?`).get(offer.id);
    note('S8-double-BC',bcs.filter(x=>x.status===201).length===1&&bcs.filter(x=>x.status===409).length===1&&engaged.n===1&&engaged.q===10,`[${bcs.map(x=>x.status).join(',')}] — BC engagés=${engaged.n}, quantité totale=${engaged.q}/10 (garde QUOTE_QTY_EXCEEDED)`);
    const bcId=bcs.find(x=>x.status===201).data.order.id;
    // S10 : double approbation simultanée du même BC
    const approvals=await Promise.all([api(0,'approver','PATCH',`/api/supplier-orders/${bcId}`,{action:'approve'}),api(1,'approver','PATCH',`/api/supplier-orders/${bcId}`,{action:'approve'})]);
    const bcStatus=db.prepare('SELECT status FROM SupplierOrder WHERE id=?').get(bcId).status;
    note('S10-double-approbation-BC',approvals.filter(x=>x.status===200).length===1&&approvals.filter(x=>x.status===409).length===1&&bcStatus==='confirmed',`[${approvals.map(x=>x.status).join(',')}] — statut BC final=${bcStatus}`);
    const bcLine=db.prepare('SELECT id FROM SupplierOrderLine WHERE orderId=?').get(bcId);
    // S9 : double réception simultanée du même BL
    const brBody={supplierOrderId:bcId,deliveryRef:`BL-${token}`,lines:[{supplierOrderLineId:bcLine.id,acceptedQty:10,rejectedQty:0,lot:token}]};
    const brs=await Promise.all([api(0,'receiver','POST','/api/goods-receipts',brBody),api(2,'receiver','POST','/api/goods-receipts',brBody)]);
    const brCount=db.prepare('SELECT count(*) n FROM GoodsReceipt WHERE deliveryRef=?').get(`BL-${token}`).n;
    const lotQty=db.prepare("SELECT coalesce(sum(qty),0) q FROM StockLot WHERE lotCode=?").get(token).q;
    note('S9-double-reception-BL',brs.filter(x=>x.status===201).length===1&&brs.filter(x=>x.status===409).length===1&&brCount===1&&lotQty===10,`[${brs.map(x=>x.status).join(',')}] — BR enregistrés=${brCount}, quantité lot=${lotQty}/10`);
  }

  // S11 : interruption brutale (SIGKILL) d'un processus pendant des écritures parallèles
  {
    const preCount=db.prepare('SELECT count(*) n FROM "Order"').get().n;
    const inflight=parallelOrders(20,false,100).catch(()=>[]);
    await new Promise(r=>setTimeout(r,80));
    const victim=servers[1];const exited=once(victim,'exit');victim.kill('SIGKILL');await exited;
    const results=await inflight.catch(()=>[]);
    await new Promise(r=>setTimeout(r,500));
    const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
    const fk=db.prepare('PRAGMA foreign_key_check').all();
    const postCount=db.prepare('SELECT count(*) n FROM "Order"').get().n;
    const partial=db.prepare(`SELECT count(*) n FROM "Order" o WHERE NOT EXISTS (SELECT 1 FROM OrderLine l WHERE l.orderId=o.id)`).get().n;
    const dupRefs=db.prepare(`SELECT count(*) n FROM (SELECT ref FROM "Order" GROUP BY ref HAVING count(*)>1)`).get().n;
    const successCount=Array.isArray(results)?results.filter(x=>x.status===201).length:0;
    note('S11-crash-sigkill',integrity==='ok'&&fk.length===0&&partial===0&&dupRefs===0,`SIGKILL pendant 20 écritures : ${successCount} complétées, intégrité=${integrity}, FK=${fk.length}, ordres sans lignes=${partial}, refs dupliquées=${dupRefs}`);
    // Reprise : une nouvelle instance démarre et écrit correctement après le crash
    servers.splice(1,1);sessions.splice(1,1);origins.splice(1,1);
    await startInstance();
    const rr=await parallelOrders(3,false,150);
    note('S11-reprise-apres-crash',rr.every(x=>x.status===201)&&new Set(rr.map(x=>x.data?.order?.ref)).size===3,`nouvelle instance : 3/3 créations réussies après crash, base toujours cohérente`);
  }

  // Contrôles finaux globaux
  {
    const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
    const fk=db.prepare('PRAGMA foreign_key_check').all();
    const dupRefs=db.prepare(`SELECT count(*) n FROM (SELECT ref FROM "Order" GROUP BY ref HAVING count(*)>1)`).get().n;
    const total=db.prepare('SELECT count(*) n FROM "Order"').get().n;
    note('FINAUX',integrity==='ok'&&fk.length===0&&dupRefs===0,`intégrité=${integrity}, FK violations=${fk.length}, refs dupliquées=${dupRefs}, commandes totales=${total} (avant=${beforeOrders})`);
  }
  const failures=report.filter(x=>!x.result).length;
  console.log(failures?`\nMATRICE CONCURRENCE : ${failures} ÉCHEC(S) sur ${report.length} scénarios`:`\nMATRICE CONCURRENCE : ${report.length}/${report.length} scénarios PASS`);
  // R13.2 : diagnostic bloquant — en cas d'échec, vider les journaux serveur
  // collectés (erreurs techniques, P1008/P2028/SQLITE_BUSY...) pour prouver
  // la cause réelle sans la deviner depuis les seuls codes HTTP.
  if(failures){
    for(const [i,o] of instanceOutputs.entries()){
      const lines=o.text.split('\n').filter(l=>/error|Error|SQLITE|P10|P20|GOCMD|Echec|Échec/i.test(l)).slice(-15);
      console.log(`--- journal instance ${i} (erreurs) ---`);console.log(lines.join('\n')||'(aucune ligne d\'erreur)');
    }
  }
  if(process.env.GOCMD_QA_ARTIFACTS){fs.mkdirSync(process.env.GOCMD_QA_ARTIFACTS,{recursive:true});fs.writeFileSync(path.join(process.env.GOCMD_QA_ARTIFACTS,'concurrency-matrix.json'),JSON.stringify(report,null,2));}
  if(failures)process.exitCode=1;
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{
  for(const server of servers)if(server.exitCode===null){const exited=once(server,'exit');server.kill();await exited;}
  db.close();fs.rmSync(temp,{recursive:true,force:true});
});
