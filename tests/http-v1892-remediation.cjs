#!/usr/bin/env node
/* V18.9.2 real-HTTP counter-audit remediation recipe (independent audit F01→F07).
 * Covers: F01 journal CSV by column names (0% and 20% VAT, multi-line, decimals,
 * freight aligned with headers), F02 post-payment refund credit + supplier
 * refund settlement (four-eyes), F03 recursive material-cost RBAC scan,
 * F04 quality rejection after invoicing with financial-correction signal,
 * F05 partial credit allocations, F06 rejected-invoice replacement link,
 * F07 enforcing CSP with nonce. NEVER run on the user's live data: refuses
 * non-local URLs and requires the explicit isolated-DB acknowledgement. */
const fetch=require('./qa-authenticated-fetch.cjs');
const assert=require('node:assert/strict');
if(process.env.GOCMD_E2E_CONFIRM!=='ISOLATED_DB_ONLY'){
 console.error('REFUSED: create a copied SQLite DB and set GOCMD_E2E_CONFIRM=ISOLATED_DB_ONLY.');process.exit(2);
}
const url=new URL(process.env.GOCMD_E2E_URL||'http://127.0.0.1:3000');
if(!['127.0.0.1','localhost','::1'].includes(url.hostname))throw Error('Remote HTTP test prohibited');
const {pdfUploader,sourcedOrder}=require('./helpers-p2p-setup.cjs');
const required=['BUYER','APPROVER','RECEIVER','QUALITY','FINANCE_A','FINANCE_B','FINANCE_C','SALES','INVENTORY','CHIEF'];
const users=Object.fromEntries(required.map(role=>{
 const name=process.env[`GOCMD_E2E_${role}_NAME`],password=process.env[`GOCMD_E2E_${role}_PASSWORD`];
 if(!name||!password)throw Error(`Missing test credential ${role}`);
 return [role,{name,password}];
}));
const log=[];
async function raw(role,method,path,body){
 const u=users[role];
 const r=await fetch(new URL(path,url),{method,headers:{authorization:'Basic '+Buffer.from(`${u.name}:${u.password}`).toString('base64'),...(body==null?{}:{'Content-Type':'application/json'})},body:body==null?undefined:JSON.stringify(body),redirect:'manual'});
 const text=await r.text();let value;try{value=JSON.parse(text)}catch{value=text}
 log.push(`${method} ${path} => ${r.status}`);
 return {status:r.status,data:value,headers:r.headers,text};
}
async function api(role,method,path,body,allowed=[200,201]){
 const r=await raw(role,method,path,body);
 if(!allowed.includes(r.status))throw Error(`Unexpected ${r.status}: ${method} ${path}: ${JSON.stringify(r.data).slice(0,900)}`);
 return r;
}
/** F03 : balayage récursif d'une réponse HTTP à la recherche de coûts matières
 * non masqués (unitPrice / averageCost non null), n'importe où dans l'arbre. */
function scanCosts(value,path){
 if(Array.isArray(value))return value.flatMap((v,i)=>scanCosts(v,`${path}[${i}]`));
 if(value&&typeof value==='object'){
  let out=[];
  for(const [k,v] of Object.entries(value)){
   if((k==='unitPrice'||k==='averageCost')&&v!==null)out.push(`${path}.${k}=${JSON.stringify(v)}`);
   out=out.concat(scanCosts(v,`${path}.${k}`));
  }
  return out;
 }
 return [];
}
(async()=>{
 const supplies=(await api('BUYER','GET','/api/suppliers')).data.items;
 const supplier=supplies.find(s=>s.active&&s.materials?.length);
 assert(supplier,'Need a referenced supplier on TEST DB');
 const links=supplier.materials.filter(l=>l.unitsPerPurchase>0);
 const link=links[0];
 const material=link.material;
 const price=Math.max(0.01,Number(link.unitPrice)||1);
 const token=`V1892-${Date.now()}`;
 const today=new Date().toISOString().slice(0,10);
 await api('APPROVER','POST','/api/p2p/sourcing',{action:'qualify',supplierId:supplier.id,status:'approved',score:95,note:`Validation contre-audit ${token}`});

 // ══ F03 : confidentialité des coûts matières, balayage récursif ══════════
 for(const role of ['QUALITY','INVENTORY','SALES','RECEIVER']){
  const materials=(await api(role,'GET','/api/materials')).data;
  const leaksM=scanCosts(materials,`/api/materials[${role}]`);
  assert(leaksM.length===0,`F03 ${role} sees material costs: ${leaksM.slice(0,3).join(' | ')}`);
  const orders=(await api(role,'GET','/api/supplier-orders')).data;
  const leaksO=scanCosts(orders,`/api/supplier-orders[${role}]`);
  assert(leaksO.length===0,`F03 ${role} sees order/material costs: ${leaksO.slice(0,3).join(' | ')}`);
  const dash=(await api(role,'GET','/api/dashboard')).data;
  const leaksD=scanCosts(dash,`/api/dashboard[${role}]`);
  assert(leaksD.length===0,`F03 ${role} sees dashboard costs: ${leaksD.slice(0,3).join(' | ')}`);
 }
 {const buyerMaterials=(await api('BUYER','GET','/api/materials')).data;
  assert(buyerMaterials.items.some(m=>m.unitPrice!==null),'F03 BUYER must still see material costs');}
 log.push('F03 recursive cost scan clean for 4 non-cost roles');

 // ══ Provisioning F02/F05 : DA → BC → BR (20 unités) ══════════════════════
 // P5.15.8 : duplicateJustification + BC avec justificatif tarifaire.
 const da1=(await api('BUYER','POST','/api/purchases',{note:`Contre-audit post-paiement ${token}`,duplicateJustification:`Recette V18.9.2 post-paiement ${token}`,lines:[{materialId:material.id,qty:20}]})).data.purchase;
 await api('APPROVER','PATCH',`/api/purchases/${da1.id}`,{action:'advance'});
 const upload=pdfUploader(url,u=>users[u]);
 const bc1=(await sourcedOrder({call:api,upload,creator:'BUYER',awarder:'CHIEF',supplierId:supplier.id,requestLineId:da1.lines[0].id,qty:20,unitPrice:price,token:`P1-${token}`,note:token})).order;
 await api('APPROVER','PATCH',`/api/supplier-orders/${bc1.id}`,{action:'approve'});
 const bc1lines=(await api('BUYER','GET','/api/supplier-orders')).data.items.find(o=>o.id===bc1.id).lines;
 await api('RECEIVER','POST','/api/goods-receipts',{supplierOrderId:bc1.id,deliveryRef:`BL-P-${token}`,lines:[{supplierOrderLineId:bc1lines[0].id,acceptedQty:20,rejectedQty:0,lot:token,expiresAt:'2027-06-01'}]});
 let lots=(await api('QUALITY','GET',`/api/stock-lots?materialId=${material.id}`)).data.items;
 const lot1=lots.find(l=>l.lotCode===token&&l.status==='available');
 assert(lot1&&lot1.qty===20,'F02 provisioning: available lot of 20');
 const receiptLine1=(await api('FINANCE_A','GET','/api/goods-receipts')).data.items.find(g=>g.supplierOrder.id===bc1.id).lines[0];

 // ══ F02 : facture ENTIÈREMENT payée, puis retour impossible en V18.9.1 ═══
 const inv1=(await api('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-P-${token}`,invoiceDate:today,freightAmount:0,lines:[{receiptLineId:receiptLine1.id,qty:20,unitPrice:price,taxRate:0}]})).data;
 await api('FINANCE_B','PATCH',`/api/supplier-invoices/${inv1.id}`,{action:'approve'});
 const pay1=(await api('FINANCE_B','PATCH',`/api/supplier-invoices/${inv1.id}`,{action:'payment',reference:`VIREMENT-${token}`,amount:Number(inv1.totalAmount)})).data;
 assert(pay1.status==='paid','F02 invoice fully paid');
 // Retour sans aucun avoir → refus (couverture exigée).
 {const r=await raw('QUALITY','POST','/api/supplier-returns',{stockLotId:lot1.id,qty:2,reason:`Anomalie matière post-paiement ${token}`});
  assert(r.status===409&&r.data.code==='CREDIT_NOTE_REQUIRED','F02 return without credit refused');}
 // Avoir de SOLDE sur facture soldée → impossible (l'ancien verrou).
 {const r=await raw('FINANCE_A','POST','/api/p2p/finance',{action:'credit',invoiceId:inv1.id,amount:Number((price).toFixed(2)),reason:`Tentative avoir de solde post-paiement ${token}`});
  assert(r.status===409&&r.data.code==='AVOIR_SUPERIEUR_SOLDE','F02 balance credit on settled invoice refused');}
 // Avoir POST-RÈGLEMENT (F02) : préparation par A, approbation par B.
 const refundCents=Math.round(9*price*100);
 const refundCredit=(await api('FINANCE_A','POST','/api/p2p/finance',{action:'refund-credit',invoiceId:inv1.id,amount:Number((refundCents/100).toFixed(2)),reason:`Non-conformité après règlement intégral ${token}`})).data.result;
 assert(refundCredit.kind==='refund'&&refundCredit.status==='draft','F02 refund credit drafted');
 // Plafond : réglé (20P) − en cours (9P) = 11P ; demander 15P → refus.
 {const r=await raw('FINANCE_A','POST','/api/p2p/finance',{action:'refund-credit',invoiceId:inv1.id,amount:Number((15*price).toFixed(2)),reason:`Avoir post-règlement excessif ${token}`});
  assert(r.status===409&&r.data.code==='AVOIR_REMBOURSEMENT_IMPOSSIBLE','F02 refund above paid-not-yet-refunded refused');}
 const approvedRefund=(await api('FINANCE_B','POST','/api/p2p/finance',{action:'approve-credit',creditId:refundCredit.id})).data.result;
 // L'approbation d'un avoir post-règlement retourne la CRÉANCE ouverte ;
 // le statut 'approved' de l'avoir lui-même est vérifié via GET juste après.
 assert(approvedRefund&&approvedRefund.creditNoteId===refundCredit.id&&approvedRefund.status==='pending','F02 refund approval opens the pending claim');
 // L'approbation ouvre la créance de remboursement fournisseur.
 let finance=(await api('FINANCE_B','GET','/api/p2p/finance')).data;
 let refund=finance.refunds.find(r=>r.creditNoteId===refundCredit.id);
 assert(refund&&refund.status==='pending'&&Number(refund.amount)===refundCents/100,'F02 supplier refund pending claim opened');
 assert(finance.credits.find(c=>c.id===refundCredit.id).status==='approved','F02 refund credit itself is approved');

 // ══ F04 : rejet qualité APRÈS facturation (payée) — quarantaine ═════════
 const rej=(await api('QUALITY','POST','/api/quality-inspections',{stockLotId:lot1.id,qty:9,decision:'reject',reason:`Non-conformité détectée après règlement ${token}`},[201])).data;
 assert(rej.financialCorrection&&rej.financialCorrection.required===true,'F04 quarantine allowed with financial-correction signal');
 assert(!('invoicedCents' in rej.financialCorrection)&&!('creditCoverageCents' in rej.financialCorrection),'F04 quality must not receive supplier invoice or credit values');
 lots=(await api('QUALITY','GET',`/api/stock-lots?materialId=${material.id}`)).data.items;
 const quar=lots.find(l=>l.lotCode===token&&l.status==='quarantine');
 assert(quar&&quar.qty===9,'F04 quarantine lot of 9');
 // Retour depuis la quarantaine SANS couverture suffisante → refus (F04/F05) :
 // le passage en quarantaine n'est plus un contournement du contrôle financier.
 {const r=await raw('QUALITY','POST','/api/supplier-returns',{stockLotId:quar.id,qty:10,reason:`Tentative retour non couvert ${token}`});
  assert(r.status===409&&r.data.code==='CREDIT_NOTE_REQUIRED','F04 quarantine return beyond credit refused');}

 // ══ F05 : affectations PARTIELLES de l'avoir (9P couvre des retours ═══
 // successifs 4 + 3 ; puis 2 ; l'avoir n'est épuisé qu'à hauteur utilisé).
 const ret1=(await api('QUALITY','POST','/api/supplier-returns',{stockLotId:quar.id,qty:4,reason:`Retour partiel 1 post-paiement ${token}`},[201])).data;
 assert(ret1.allocatedCents===null&&ret1.creditAllocations.length===0,'F05 first return hides financial allocations from quality');
 const ret2=(await api('QUALITY','POST','/api/supplier-returns',{stockLotId:quar.id,qty:3,reason:`Retour partiel 2 post-paiement ${token}`},[201])).data;
 assert(ret2.allocatedCents===null&&ret2.creditAllocations.length===0,'F05 second return hides financial allocations from quality');
 // Reste mobilisable : 9P − 7P = 2P. Un retour de 3 (3P) doit être refusé,
 // preuve que l'avoir n'est PAS consommé en totalité par le premier retour.
 {const r=await raw('QUALITY','POST','/api/supplier-returns',{stockLotId:quar.id,qty:3,reason:`Retour au-delà du reste d'avoir ${token}`});
  assert(r.status===409&&r.data.code==='CREDIT_NOTE_REQUIRED','F05 return above remaining credit refused');}
 const ret3=(await api('QUALITY','POST','/api/supplier-returns',{stockLotId:quar.id,qty:2,reason:`Retour partiel 3 post-paiement ${token}`},[201])).data;
 assert(ret3.allocatedCents===null&&ret3.creditAllocations.length===0,'F05 third return hides financial allocations from quality');
 finance=(await api('FINANCE_B','GET','/api/p2p/finance')).data;
 const creditState=finance.credits.find(c=>c.id===refundCredit.id);
 assert(creditState.remainingCents===0,'F05 finance verifies exact consumption while quality receives no amounts');
 assert([ret1,ret2,ret3].every(r=>r.creditAllocations.length===0&&r.allocatedCents===null),'F05 allocation values must not leak to quality');
 lots=(await api('QUALITY','GET',`/api/stock-lots?materialId=${material.id}`)).data.items;
 const returnedLot=lots.find(l=>l.lotCode===token&&l.status==='returned');
 assert(returnedLot&&returnedLot.qty===9,'F05 returned lot holds 9 (4+3+2)');

 // ══ F02 : solder la créance — quatre-yeux puis rapprochement ════════════
 refund=finance.refunds.find(r=>r.creditNoteId===refundCredit.id);
 {const r=await raw('FINANCE_A','POST','/api/p2p/finance',{action:'settle-refund',refundId:refund.id,method:'bank',reference:`TR-${token}`});
  assert(r.status===409&&r.data.code==='REMBOURSEMENT_AUTO','F02 preparer cannot settle own refund');}
// Audit 10/11/2026 (FIN-4E-01) : l'APPROBATEUR de l'avoir ne peut pas non plus
// solder le remboursement qu'il a lui-même ouvert (décision ≠ exécution).
{const r=await raw('FINANCE_B','POST','/api/p2p/finance',{action:'settle-refund',refundId:refund.id,method:'bank',reference:`TRB-${token}`});
 assert(r.status===409&&r.data.code==='REMBOURSEMENT_AUTO','FIN-4E-01 refund approver cannot settle own decision');}
 const settled=(await api('FINANCE_C','POST','/api/p2p/finance',{action:'settle-refund',refundId:refund.id,method:'offset',reference:`IMPUT-${token}`},[201])).data.result;
 assert(settled.status==='refunded'&&settled.method==='offset','F02 refund settled by a third account with method');
 {const r=await raw('FINANCE_C','POST','/api/p2p/finance',{action:'settle-refund',refundId:refund.id,method:'bank',reference:`X-${token}`});
  assert(r.status===409&&r.data.code==='REMBOURSEMENT_INTROUVABLE','F02 already-settled refund refused');}
 finance=(await api('FINANCE_B','GET','/api/p2p/finance')).data;
 const inv1Balance=finance.balances.find(b=>b.invoiceId===inv1.id);
 assert(inv1Balance.status==='paid'&&inv1Balance.outstanding==='0.00','F02 paid invoice keeps zero outstanding');
 assert(Number(inv1Balance.refundable)===Math.round((20*price-9*price)*100)/100,'F02 refundable reflects consumed refunds');

 // ══ F01 : journal comptable — TVA 20 %, multi-lignes, décimales, fret ═══
 const link2=links.find(l=>l.materialId!==material.id)||links[0];
 const material2=link2.material;
 const price2=Math.max(0.01,Number(link2.unitPrice)||1);
 const da2=(await api('BUYER','POST','/api/purchases',{note:`Contre-audit journal TVA ${token}`,duplicateJustification:`Recette V18.9.2 journal TVA ${token}`,lines:[{materialId:material.id,qty:6},{materialId:material2.id,qty:4}]})).data.purchase;
 await api('APPROVER','PATCH',`/api/purchases/${da2.id}`,{action:'advance'});
 // Deux lignes = deux RFQ : consultation commune, devis+PDF par matière,
 // attribution quatre yeux, BC référençant chaque devis.
 const cons2=(await api('BUYER','POST','/api/p2p/consultations',{lines:[{requestLineId:da2.lines[0].id,qty:6},{requestLineId:da2.lines[1].id,qty:4}],supplierIds:[supplier.id]})).data.consultation;
 assert(cons2?.id,'consultation TVA créée');
 const src2=(await api('BUYER','GET','/api/p2p/sourcing?pageSize=150')).data;
 const srcOf=async (requestLineId,qty,unitPrice,suffix)=>{
  const rfq=src2.rfqs.find(r=>r.requestLineId===requestLineId&&r.status==='open');assert(rfq,'RFQ TVA');
  const offer=(await api('BUYER','POST','/api/p2p/sourcing',{action:'offer',rfqId:rfq.id,supplierId:supplier.id,unitPrice,priceBasis:'STOCK',qty,leadTimeDays:5,quoteRef:`DEV-${suffix}-${token}`,validUntil:new Date(Date.now()+30*864e5).toISOString().slice(0,10),documentRef:`PDF-${suffix}`})).data.result;
  await upload('BUYER',offer.id,`dev-${suffix}.pdf`);
  await require('./helpers-p2p-setup.cjs').approveOfferPlan({call:api,creator:'BUYER',awarder:'CHIEF',rfqId:rfq.id,offerId:offer.id,qty});
  return offer.id;
 };
 const srcLine1=await srcOf(da2.lines[0].id,6,price,'J1');
 const srcLine2=await srcOf(da2.lines[1].id,4,price2,'J2');
 const bc2=(await api('BUYER','POST','/api/supplier-orders',{supplierId:supplier.id,note:token,lines:[{requestLineId:da2.lines[0].id,qty:6,unitPrice:price,sourceType:'QUOTE',sourceId:srcLine1},{requestLineId:da2.lines[1].id,qty:4,unitPrice:price2,sourceType:'QUOTE',sourceId:srcLine2}]})).data.order;
 await api('APPROVER','PATCH',`/api/supplier-orders/${bc2.id}`,{action:'approve'});
 const bc2lines=(await api('BUYER','GET','/api/supplier-orders')).data.items.find(o=>o.id===bc2.id).lines;
 await api('RECEIVER','POST','/api/goods-receipts',{supplierOrderId:bc2.id,deliveryRef:`BL-J-${token}`,lines:[
  {supplierOrderLineId:bc2lines[0].id,acceptedQty:6,rejectedQty:0,lot:`${token}-J1`,expiresAt:'2027-06-01'},
  {supplierOrderLineId:bc2lines[1].id,acceptedQty:4,rejectedQty:0,lot:`${token}-J2`,expiresAt:'2027-06-01'}]});
 const gr2=(await api('FINANCE_A','GET','/api/goods-receipts')).data.items.find(g=>g.supplierOrder.id===bc2.id);
 const freightAmount=33.33;
 const inv2=(await api('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-T-${token}`,invoiceDate:today,freightAmount,lines:[
  {receiptLineId:gr2.lines[0].id,qty:6,unitPrice:price,taxRate:20},
  {receiptLineId:gr2.lines[1].id,qty:4,unitPrice:price2,taxRate:20}]})).data;
 assert(inv2.status==='matched','F01 multi-line VAT invoice matched');
 // Totaux attendus : arrondi par ligne au centime, TVA sur les centimes HT.
 const l1ht=Math.round(6*price*100),l1tax=Math.round(l1ht*20/100);
 const l2ht=Math.round(4*price2*100),l2tax=Math.round(l2ht*20/100);
 const freightCents=Math.round(freightAmount*100);
 const expectedTotal=l1ht+l1tax+l2ht+l2tax+freightCents;
 assert(Math.round(Number(inv2.totalAmount)*100)===expectedTotal,'F01 invoice total = lines+VAT+freight (cents)');
 // Journal : lecture PAR NOMS DE COLONNES uniquement.
 const journal=(await api('FINANCE_A','GET','/api/p2p/accounting-export')).text.replace(/^\uFEFF/,'');
 const rows=journal.split('\r\n').map(r=>r.split(';').map(c=>c.replace(/^"|"$/g,'').replace(/""/g,'"')));
 const head=rows[0];
 const idx=name=>{const i=head.indexOf(name);assert(i>=0,`F01 missing column ${name}`);return i;};
 const NATURE=idx('Nature de ligne'),NUM=idx('Numéro facture'),QTY=idx('Quantité'),PU=idx('Prix HT'),TAXR=idx('Taux taxe %'),HT=idx('Base HT'),TAX=idx('Taxe estimée'),TTC=idx('TTC estimé'),SUP=idx('Fournisseur');
 assert(head.length===16,'F01 header carries 16 columns');
 assert(rows.slice(1).every(r=>r.length===head.length),'F01 EVERY row has exactly the header field count');
 const inv2rows=rows.filter(r=>r[NUM]===`FAC-T-${token}`);
 assert(inv2rows.length===3,'F01 two goods lines + one FRET line');
 assert(inv2rows.filter(r=>r[NATURE]==='ARTICLE').length===2&&inv2rows.filter(r=>r[NATURE]==='FRET').length===1,'F01 nature de ligne explicit on every row');
 const freightRow=inv2rows.find(r=>r[NATURE]==='FRET');
 assert(freightRow[QTY]==='1'&&freightRow[PU]===freightAmount.toFixed(4)&&freightRow[TAXR]==='0.0000','F01 FRET quantity/price/tax-rate aligned with headers');
 assert(freightRow[HT]===freightAmount.toFixed(2)&&freightRow[TAX]==='0.00'&&freightRow[TTC]===freightAmount.toFixed(2),'F01 FRET HT/VAT/TTC aligned with headers');
 const ttcSum=inv2rows.reduce((s,r)=>s+Math.round(Number(r[TTC])*100),0);
 const taxSum=inv2rows.reduce((s,r)=>s+Math.round(Number(r[TAX])*100),0);
 assert(ttcSum===expectedTotal,'F01 TTC column (freight included) equals invoice total to the cent');
 assert(taxSum===l1tax+l2tax,'F01 VAT column equals expected VAT (no tax double count)');
 // Contrôle global : pour CHAQUE facture, somme TTC du journal = total en base.
 const invoiceList=(await api('FINANCE_A','GET','/api/supplier-invoices')).data.items;
 const byKey=new Map(rows.slice(1).map(r=>[`${r[SUP]}|${r[NUM]}`,r]));
 for(const inv of invoiceList){
  const invRows=rows.slice(1).filter(r=>r[SUP]===inv.supplier.name&&r[NUM]===inv.invoiceNumber);
  if(!invRows.length)continue;
  const sum=invRows.reduce((s,r)=>s+Math.round(Number(r[TTC])*100),0);
  assert(sum===Math.round(Number(inv.totalAmount)*100),`F01 journal TTC sum equals DB total for ${inv.invoiceNumber}`);
 }
 log.push(`F01 journal verified globally on ${invoiceList.length} invoices`);

 // ══ F06 : facture bloquée → rejet → rectification LIÉE (numéro distinct) ═
 const da3=(await api('BUYER','POST','/api/purchases',{note:`Contre-audit remplacement ${token}`,duplicateJustification:`Recette V18.9.2 remplacement ${token}`,lines:[{materialId:material.id,qty:5}]})).data.purchase;
 await api('APPROVER','PATCH',`/api/purchases/${da3.id}`,{action:'advance'});
 const bc3=(await sourcedOrder({call:api,upload,creator:'BUYER',awarder:'CHIEF',supplierId:supplier.id,requestLineId:da3.lines[0].id,qty:5,unitPrice:price,token:`R3-${token}`,note:token})).order;
 await api('APPROVER','PATCH',`/api/supplier-orders/${bc3.id}`,{action:'approve'});
 const bc3lines=(await api('BUYER','GET','/api/supplier-orders')).data.items.find(o=>o.id===bc3.id).lines;
 await api('RECEIVER','POST','/api/goods-receipts',{supplierOrderId:bc3.id,deliveryRef:`BL-R-${token}`,lines:[{supplierOrderLineId:bc3lines[0].id,acceptedQty:5,rejectedQty:0,lot:`${token}-R`,expiresAt:'2027-06-01'}]});
 const gr3=(await api('FINANCE_A','GET','/api/goods-receipts')).data.items.find(g=>g.supplierOrder.id===bc3.id);
 const inv3=(await api('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-R-${token}`,invoiceDate:today,freightAmount:0,lines:[{receiptLineId:gr3.lines[0].id,qty:5,unitPrice:Number((price*2).toFixed(4)),taxRate:0}]})).data;
 assert(inv3.status==='blocked','F06 wrong-price invoice blocked');
 await api('FINANCE_B','PATCH',`/api/supplier-invoices/${inv3.id}`,{action:'reject',reason:`Écart prix fournisseur, rectification attendue ${token}`});
 // Le remplacement d'une facture NON rejetée doit être refusé.
 {const r=await raw('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-RX-${token}`,invoiceDate:today,freightAmount:0,replacesInvoiceId:inv2.id,lines:[{receiptLineId:gr3.lines[0].id,qty:5,unitPrice:price,taxRate:0}]});
  assert(r.status===409&&r.data.code==='REPLACED_INVOICE_NOT_REJECTED','F06 replacement of a non-rejected invoice refused');}
 // Rectification : NUMÉRO DISTINCT + lien explicite vers la rejetée.
 const inv4=(await api('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-R2-${token}`,invoiceDate:today,freightAmount:0,replacesInvoiceId:inv3.id,lines:[{receiptLineId:gr3.lines[0].id,qty:5,unitPrice:price,taxRate:0}]})).data;
 assert(inv4.status==='matched'&&inv4.replacesInvoiceId===inv3.id,'F06 corrected invoice linked to the rejected one');
 const invList=(await api('FINANCE_A','GET','/api/supplier-invoices')).data.items;
 const inv4item=invList.find(i=>i.id===inv4.id),inv3item=invList.find(i=>i.id===inv3.id);
 assert(inv4item.replacesInvoice&&inv4item.replacesInvoice.invoiceNumber===`FAC-R-${token}`&&inv4item.replacesInvoice.status==='rejected','F06 replacement link readable');
 assert((inv3item.replacedBy??[]).some(x=>x.id===inv4.id),'F06 replaced invoice lists its successor');
 {const r=await raw('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-R-${token}`,invoiceDate:today,freightAmount:0,lines:[{receiptLineId:gr3.lines[0].id,qty:5,unitPrice:price,taxRate:0}]});
  assert(r.status===409,'F06 rejected number stays unique (no reuse)');}

 // ══ F07 : CSP appliquée avec nonce sur les pages ════════════════════════
 const page=(await raw('QUALITY','GET','/'));
 const csp=page.headers.get('content-security-policy');
 assert(page.headers.get('content-security-policy-report-only')===null,'F07 no Report-Only anymore');
 const nonce=(csp&&csp.match(/nonce-([A-Za-z0-9+/=]+)/)||[])[1];
 assert(csp&&nonce,'F07 enforcing CSP with per-request nonce');
 assert(csp.includes('strict-dynamic'),'F07 strict-dynamic present');
 assert(!csp.includes("script-src 'self' 'unsafe-inline'"),'F07 no unsafe-inline in script-src');
 assert((page.text.match(new RegExp(`nonce="${nonce}"`,'g'))||[]).length>0,'F07 rendered scripts carry the nonce');
 const page2=(await raw('SALES','GET','/'));
 const nonce2=(page2.headers.get('content-security-policy')||'').match(/nonce-([A-Za-z0-9+/=]+)/);
 assert(nonce2&&nonce2[1]!==nonce,'F07 nonce differs per request');

 console.log(`PASS V18.9.2 contre-audit indépendant HTTP: ${log.length} requêtes — F01/F02/F03/F04/F05/F06/F07 vérifiés`);
})().catch(e=>{console.error('FAIL V18.9.2:',e.message);process.exit(1)});
