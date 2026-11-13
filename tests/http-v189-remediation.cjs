#!/usr/bin/env node
/* V18.9 real-HTTP remediation recipe: DA cancellation + closed-BC resurrection guard.
 * NEVER run on the user's live data: refuses non-local URLs and requires the
 * explicit isolated-DB acknowledgement, like the other HTTP recipes. */
const fetch=require('./qa-authenticated-fetch.cjs');
const assert=require('node:assert/strict');
if(process.env.GOCMD_E2E_CONFIRM!=='ISOLATED_DB_ONLY'){
 console.error('REFUSED: create a copied SQLite DB and set GOCMD_E2E_CONFIRM=ISOLATED_DB_ONLY.');process.exit(2);
}
const url=new URL(process.env.GOCMD_E2E_URL||'http://127.0.0.1:3000');
if(!['127.0.0.1','localhost','::1'].includes(url.hostname))throw Error('Remote HTTP test prohibited');
const {pdfUploader,sourcedOrder}=require('./helpers-p2p-setup.cjs');
const required=['BUYER','APPROVER','RECEIVER','QUALITY','CHIEF'];
const users=Object.fromEntries(required.map(role=>{
 const name=process.env[`GOCMD_E2E_${role}_NAME`],password=process.env[`GOCMD_E2E_${role}_PASSWORD`];
 if(!name||!password)throw Error(`Missing test credential ${role}`);
 return [role,{name,password}];
}));
const log=[];
async function api(role,method,path,body,allowed=[200,201]){
 const u=users[role];
 const r=await fetch(new URL(path,url),{method,headers:{authorization:'Basic '+Buffer.from(`${u.name}:${u.password}`).toString('base64'),...(body==null?{}:{'Content-Type':'application/json'})},body:body==null?undefined:JSON.stringify(body),redirect:'manual'});
 const text=await r.text();let value;try{value=JSON.parse(text)}catch{value=text.slice(0,1000)}
 log.push(`${method} ${path} => ${r.status}`);
 if(!allowed.includes(r.status))throw Error(`Unexpected ${r.status}: ${method} ${path}: ${JSON.stringify(value).slice(0,900)}`);
 return {status:r.status,data:value};
}
(async()=>{
 const supplies=(await api('BUYER','GET','/api/suppliers')).data.items;
 const supplier=supplies.find(s=>s.active&&s.materials?.length);
 assert(supplier,'Need a referenced supplier on TEST DB');
 const link=supplier.materials.find(l=>l.unitsPerPurchase>0);assert(link);
 const material=link.material;const price=Math.max(0.01,Number(link.unitPrice)||1);
 const token=`V189-${Date.now()}`;
 // Qualification du fournisseur par un responsable (pré requis d'approbation BC).
 await api('APPROVER','POST','/api/p2p/sourcing',{action:'qualify',supplierId:supplier.id,status:'approved',score:95,note:`Validation de test ${token}`});

 // ── Scénario 1 : un BC clôturé ne doit pas être ressuscité par la qualité ──
 // P5.15.8 : duplicateJustification (sortie prévue par l'API) car les scénarios
 // de la recette créent volontairement plusieurs DA sur la même matière.
 const da=(await api('BUYER','POST','/api/purchases',{note:`Garde BC clos ${token}`,duplicateJustification:`Recette V18.9 scénario BC clos ${token}`,lines:[{materialId:material.id,qty:6}]})).data.purchase;
 await api('APPROVER','PATCH',`/api/purchases/${da.id}`,{action:'advance'});
 // P5.15.8 : le BC exige désormais un justificatif tarifaire (devis attribué
 // avec PDF) ; l'attribution est faite par CHIEF, distinct du créateur.
 const upload=pdfUploader(url,u=>users[u]);
 const sourced=await sourcedOrder({call:api,upload,creator:'BUYER',awarder:'CHIEF',supplierId:supplier.id,requestLineId:da.lines[0].id,qty:6,unitPrice:price,token:`S1-${token}`,note:token});
 const bc=sourced.order;
 await api('APPROVER','PATCH',`/api/supplier-orders/${bc.id}`,{action:'approve'});
 const lines=(await api('BUYER','GET','/api/supplier-orders')).data.items.find(o=>o.id===bc.id)?.lines;
 assert(lines?.length,'Expected supplierOrderLine');
 // BR partiel : 2 acceptées, 2 refusées (quarantaine), 2 non livrées.
 await api('RECEIVER','POST','/api/goods-receipts',{supplierOrderId:bc.id,deliveryRef:`BL-${token}`,lines:[{supplierOrderLineId:lines[0].id,acceptedQty:2,rejectedQty:2,lot:token}]});
 let lots=(await api('QUALITY','GET',`/api/stock-lots?materialId=${material.id}`)).data.items;
 const quarantined=lots.find(l=>l.lotCode===token&&l.status==='quarantine');assert(quarantined,'quarantined lot expected');
 // Clôture anticipée du solde BC (2 non livrées libérées).
 await api('APPROVER','PATCH',`/api/supplier-orders/${bc.id}`,{action:'close',reason:`Solde annulé, fin de série ${token}`});
 let closed=(await api('APPROVER','GET','/api/supplier-orders')).data.items.find(o=>o.id===bc.id);
 assert.equal(closed.status,'closed','BC must be closed before the quality release attempt');
 // Libération qualité du lot quarantaine alors que le BC est clôturé.
 await api('QUALITY','POST','/api/quality-inspections',{stockLotId:quarantined.id,qty:2,decision:'release',reason:`Réinspection favorable après clôture ${token}`});
 closed=(await api('APPROVER','GET','/api/supplier-orders')).data.items.find(o=>o.id===bc.id);
 assert.equal(closed.status,'closed','V18.9: a quality release must NOT resurrect a closed BC');
 assert(closed.closedAt,'closed BC must keep its closure metadata');
 // La DA liée à un BC ne peut pas être annulée.
 await api('APPROVER','PATCH',`/api/purchases/${da.id}`,{action:'cancel',reason:`Tentative sur DA liée ${token}`},[409]);

 // ── Scénario 2 : annulation contrôlée d'une DA non commandée ──
 const da2=(await api('BUYER','POST','/api/purchases',{note:`Annulation contrôlée ${token}`,duplicateJustification:`Recette V18.9 scénario annulation ${token}`,lines:[{materialId:material.id,qty:3}]})).data.purchase;
 // Le demandeur (rôle acheteur seul) n'a pas le droit d'agir sur les transitions.
 await api('BUYER','PATCH',`/api/purchases/${da2.id}`,{action:'cancel',reason:`Tentative acheteur ${token}`},[403]);
 // Motif trop court refusé.
 await api('APPROVER','PATCH',`/api/purchases/${da2.id}`,{action:'cancel',reason:'court'},[409]);
 // DA encore « à valider » : un approbateur peut l'annuler.
 const cancelledPending=await api('APPROVER','PATCH',`/api/purchases/${da2.id}`,{action:'cancel',reason:`Besoin abandonné par le demandeur ${token}`});
 assert.equal(cancelledPending.data.purchase.status,'cancelled');
 assert(cancelledPending.data.purchase.closedBy===users.APPROVER.name,'cancel decision actor must be recorded');
 // Double annulation impossible.
 await api('APPROVER','PATCH',`/api/purchases/${da2.id}`,{action:'cancel',reason:`Nouvelle tentative ${token}`},[409]);

 // ── Scénario 3 : quatre yeux sur l'annulation d'une DA validée ──
 // CHIEF cumule acheteur + approbateur : il crée et fait valider par un autre.
 const da3=(await api('CHIEF','POST','/api/purchases',{note:`Quatre yeux ${token}`,duplicateJustification:`Recette V18.9 scénario quatre yeux ${token}`,lines:[{materialId:material.id,qty:2}]})).data.purchase;
 await api('CHIEF','PATCH',`/api/purchases/${da3.id}`,{action:'advance'},[409]); // SELF_APPROVAL
 await api('APPROVER','PATCH',`/api/purchases/${da3.id}`,{action:'advance'});
 // Le demandeur cumulant les rôles ne peut pas annuler sa propre DA validée.
 await api('CHIEF','PATCH',`/api/purchases/${da3.id}`,{action:'cancel',reason:`Annulation par le demandeur ${token}`},[409]);
 const cancelledByOther=await api('APPROVER','PATCH',`/api/purchases/${da3.id}`,{action:'cancel',reason:`Validée à tort, annulée par un tiers ${token}`});
 assert.equal(cancelledByOther.data.purchase.status,'cancelled');

 console.log('PASS HTTP V18.9:',log.length,'HTTP requests. Closed-BC guard, DA cancel (pending/approved, four-eyes, linked-BC refusal); all on TEST DB.');
 console.log(log.join('\n'));
})().catch(e=>{console.error('FAIL HTTP V18.9:',e.stack||e);console.error(log.join('\n'));process.exitCode=1;});
