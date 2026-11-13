#!/usr/bin/env node
/* Real-HTTP end-to-end receipt/quality/invoice/payment/inventory recipe.
 * NEVER run on the user's live data. The script intentionally refuses any URL
 * other than localhost and requires explicit test-copy acknowledgement.
 * P5.15.8 : le circuit suit les règles de sourcing actuelles — un BC exige
 * un justificatif tarifaire (devis attribué avec PDF) ; la consultation est
 * créée par l'acheteur et attribuée par un compte DISTINCT (quatre yeux,
 * AUTO_ATTRIBUTION interdite), comme en production. */
const fetch=require('./qa-authenticated-fetch.cjs');
const assert=require('node:assert/strict');
if(process.env.GOCMD_E2E_CONFIRM!=='ISOLATED_DB_ONLY'){
 console.error('REFUSED: create a copied SQLite DB and set GOCMD_E2E_CONFIRM=ISOLATED_DB_ONLY.');process.exit(2);
}
const url=new URL(process.env.GOCMD_E2E_URL||'http://127.0.0.1:3000');
if(!['127.0.0.1','localhost','::1'].includes(url.hostname))throw Error('Remote HTTP test prohibited');
const required=['BUYER','APPROVER','RECEIVER','QUALITY','FINANCE_A','FINANCE_B','INVENTORY','CHIEF'];
const users=Object.fromEntries(required.map(role=>{
 const name=process.env[`GOCMD_E2E_${role}_NAME`],password=process.env[`GOCMD_E2E_${role}_PASSWORD`];
 if(!name||!password)throw Error(`Missing test credential ${role}`);
 return [role,{name,password}];
}));
if(new Set(required.map(r=>users[r].name)).size!==required.length)throw Error('Use separate named test accounts for all roles');
const log=[];
async function api(role,method,path,body,allowed=[200,201]){
 const u=users[role];
 const r=await fetch(new URL(path,url),{method,headers:{authorization:'Basic '+Buffer.from(`${u.name}:${u.password}`).toString('base64'),...(body==null?{}:{'Content-Type':'application/json'})},body:body==null?undefined:JSON.stringify(body),redirect:'manual'});
 const text=await r.text();let value;try{value=JSON.parse(text)}catch{value=text.slice(0,1000)}
 log.push(`${method} ${path} => ${r.status}`);
 if(!allowed.includes(r.status))throw Error(`Unexpected ${r.status}: ${method} ${path}: ${JSON.stringify(value).slice(0,900)}`);
 return {status:r.status,data:value};
}
async function uploadPdf(role,offerId,name){
 const u=users[role];
 const form=new FormData();
 form.set('offerId',String(offerId));
 // PDF minimal valide : l'API vérifie la magie %PDF- et l'extension.
 form.set('file',new Blob(['%PDF-1.4\n%Recette HTTP P2P GoCmd\n'],{type:'application/pdf'}),name);
 const r=await fetch(new URL('/api/p2p/offer-documents',url),{method:'POST',headers:{authorization:'Basic '+Buffer.from(`${u.name}:${u.password}`).toString('base64')},body:form});
 const value=await r.json().catch(()=>null);
 log.push(`POST /api/p2p/offer-documents => ${r.status}`);
 if(r.status!==201)throw Error(`Unexpected ${r.status} offer document: ${JSON.stringify(value).slice(0,400)}`);
 return value;
}
(async()=>{
 const supplies=(await api('BUYER','GET','/api/suppliers')).data.items;
 const supplier=supplies.find(s=>s.active&&s.materials?.length);
 assert(supplier,'Need a referenced supplier on TEST DB');
 const link=supplier.materials.find(l=>l.unitsPerPurchase>0);assert(link);
 const material=link.material;const price=Math.max(0.01,Number(link.unitPrice)||1);
 const token=`E2E-${Date.now()}`;
 await api('APPROVER','POST','/api/p2p/sourcing',{action:'qualify',supplierId:supplier.id,status:'approved',score:95,note:`Validation de test ${token}`});
 const created=(await api('BUYER','POST','/api/purchases',{note:token,duplicateJustification:`Recette HTTP P2P ${token} : besoin de test dédié`,lines:[{materialId:material.id,qty:10}]})).data.purchase;
 const requestLine=created.lines[0];assert(requestLine);
 await api('BUYER','PATCH',`/api/purchases/${created.id}`,{action:'advance'},[403]);
 await api('APPROVER','PATCH',`/api/purchases/${created.id}`,{action:'advance'});
 // ── Sourcing P5.15 : consultation → devis écrit → PDF → attribution ──
 const consultation=(await api('BUYER','POST','/api/p2p/consultations',{lines:[{requestLineId:requestLine.id,qty:10}],supplierIds:[supplier.id]})).data.consultation;
 assert(consultation?.id,'Consultation créée');
 const sourcing=(await api('BUYER','GET','/api/p2p/sourcing?pageSize=150')).data;
 const rfq=sourcing.rfqs.find(r=>r.requestLineId===requestLine.id&&r.status==='open');
 assert(rfq,'RFQ ouverte pour la ligne DA');
 const offer=(await api('BUYER','POST','/api/p2p/sourcing',{action:'offer',rfqId:rfq.id,supplierId:supplier.id,unitPrice:price,priceBasis:'STOCK',qty:10,leadTimeDays:5,quoteRef:`DEV-${token}`,validUntil:new Date(Date.now()+30*864e5).toISOString().slice(0,10),documentRef:`PDF-DEV-${token}`})).data.result;
 assert(offer?.id,'Offre écrite enregistrée');
 await uploadPdf('BUYER',offer.id,`dev-${token}.pdf`);
 // Attribution par un compte distinct du créateur de la consultation (quatre yeux).
 const awarded=await require('./helpers-p2p-setup.cjs').approveOfferPlan({call:api,creator:'BUYER',awarder:'CHIEF',rfqId:rfq.id,offerId:offer.id,qty:10});
 assert(awarded.data.result?.next,'Attribution confirmée');
 const bc=(await api('BUYER','POST','/api/supplier-orders',{supplierId:supplier.id,note:token,lines:[{requestLineId:requestLine.id,qty:10,unitPrice:price,sourceType:'QUOTE',sourceId:offer.id}]})).data.order;
 await api('BUYER','PATCH',`/api/supplier-orders/${bc.id}`,{action:'approve'},[403]);
 const approved=await api('APPROVER','PATCH',`/api/supplier-orders/${bc.id}`,{action:'approve'});
 assert.equal(approved.data.status,'confirmed','BC approval must actually work through Prisma');
 const lines=(await api('BUYER','GET','/api/supplier-orders')).data.items.find(o=>o.id===bc.id)?.lines;
 assert(lines?.length,'Expected supplierOrderLine');
 const delivery={supplierOrderId:bc.id,deliveryRef:`BL-${token}`,lines:[{supplierOrderLineId:lines[0].id,acceptedQty:7,rejectedQty:3,lot:token}]};
 await api('RECEIVER','POST','/api/goods-receipts',delivery);
 await api('RECEIVER','POST','/api/goods-receipts',delivery,[409]);
 await api('RECEIVER','POST','/api/goods-receipts',{...delivery,deliveryRef:`BL2-${token}`,lines:[{...delivery.lines[0],acceptedQty:100,rejectedQty:0}]},[409]);
 let lots=(await api('QUALITY','GET',`/api/stock-lots?materialId=${material.id}`)).data.items;
 const quarantined=lots.find(l=>l.lotCode===token&&l.status==='quarantine');assert(quarantined);
 await api('QUALITY','POST','/api/quality-inspections',{stockLotId:quarantined.id,qty:3,decision:'release',reason:`Réinspection favorable ${token}`});
 lots=(await api('QUALITY','GET',`/api/stock-lots?materialId=${material.id}`)).data.items;
 const available=lots.find(l=>l.lotCode===token&&l.status==='available');assert(available);
 const returned=await api('QUALITY','POST','/api/supplier-returns',{stockLotId:available.id,qty:2,reason:`Retour échantillon du test ${token}`,creditExpected:false});assert(returned.data.id);
 const receipts=(await api('FINANCE_A','GET','/api/goods-receipts')).data.items;
 const rl=receipts.find(r=>r.deliveryRef===delivery.deliveryRef.toUpperCase())?.lines.find(l=>l.supplierOrderLineId===lines[0].id);
 assert(rl,'Missing receipt line');
 const invoice=(await api('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FACT-${token}`,invoiceDate:new Date().toISOString().slice(0,10),freightAmount:0,lines:[{receiptLineId:rl.id,qty:8,unitPrice:price,taxRate:0}]})).data;
 assert.equal(invoice.status,'matched');
 await api('FINANCE_A','PATCH',`/api/supplier-invoices/${invoice.id}`,{action:'approve'},[409]);
 await api('FINANCE_B','PATCH',`/api/supplier-invoices/${invoice.id}`,{action:'approve'});
 const paid=await api('FINANCE_B','PATCH',`/api/supplier-invoices/${invoice.id}`,{action:'payment',reference:`PAIE-${token}`,amount:Math.round(Number(invoice.totalAmount)*100)/100});
 assert.equal(paid.data.status,'paid');
 const stock=(await api('INVENTORY','GET','/api/p2p/warehouse')).data;
 const placement=stock.placements.find(x=>x.stockLotId===available.id);assert(placement,'Need placement for test lot');
 const count=(await api('INVENTORY','POST','/api/p2p/warehouse',{action:'count',lotId:available.id,locationId:placement.locationId,observedQty:placement.qty,reason:`Comptage de test ${token}`})).data.result;
 await api('INVENTORY','POST','/api/p2p/warehouse',{action:'approveCount',countId:count.id,approved:true,reason:`Validation par un autre compte ${token}`},[403]);
 await api('APPROVER','POST','/api/p2p/warehouse',{action:'approveCount',countId:count.id,approved:true,reason:`Double validation du test ${token}`});
 console.log('PASS HTTP P2P:',log.length,'HTTP requests. DA, sourcing (consultation/devis/PDF/attribution quatre yeux), BC justifié, approval BC, partial BR, duplicate BL, QC, return, invoice, payment, inventory; all on TEST DB.');
 console.log(log.join('\n'));
})().catch(e=>{console.error('FAIL HTTP P2P:',e.stack||e);console.error(log.join('\n'));process.exitCode=1;});
