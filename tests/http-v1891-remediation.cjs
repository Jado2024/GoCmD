#!/usr/bin/env node
/* V18.9.1 real-HTTP counter-audit remediation recipe.
 * Covers: A-02 credit-backed returns, A-03 dashboard RBAC DTO, A-04 lot expiry,
 * A-05 blocked-invoice rejection + re-registration, A-06 freight journal line,
 * A-07 unsafe amounts, A-09 read RBAC matrix, A-11 fast P2002 conflict,
 * A-13 CSP Report-Only header. NEVER run on the user's live data: refuses
 * non-local URLs and requires the explicit isolated-DB acknowledgement. */
const fetch=require('./qa-authenticated-fetch.cjs');
const assert=require('node:assert/strict');
if(process.env.GOCMD_E2E_CONFIRM!=='ISOLATED_DB_ONLY'){
 console.error('REFUSED: create a copied SQLite DB and set GOCMD_E2E_CONFIRM=ISOLATED_DB_ONLY.');process.exit(2);
}
const url=new URL(process.env.GOCMD_E2E_URL||'http://127.0.0.1:3000');
if(!['127.0.0.1','localhost','::1'].includes(url.hostname))throw Error('Remote HTTP test prohibited');
const {pdfUploader,sourcedOrder}=require('./helpers-p2p-setup.cjs');
const required=['BUYER','APPROVER','RECEIVER','QUALITY','FINANCE_A','FINANCE_B','SALES','INVENTORY','CHIEF'];
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
(async()=>{
 const supplies=(await api('BUYER','GET','/api/suppliers')).data.items;
 const supplier=supplies.find(s=>s.active&&s.materials?.length);
 assert(supplier,'Need a referenced supplier on TEST DB');
 assert(supplier.materials.every(l=>typeof l.unitPrice==='number'||l.unitPrice===null),'unitPrice must be number|null');
 // A-09 : BUYER voit les tarifs fournisseurs.
 assert(supplier.materials.some(l=>l.unitPrice!==null),'BUYER must see supplier prices');
 const link=supplier.materials.find(l=>l.unitsPerPurchase>0);assert(link);
 const material=link.material;const price=Math.max(0.01,Number(link.unitPrice)||1);
 const token=`V1891-${Date.now()}`;
 await api('APPROVER','POST','/api/p2p/sourcing',{action:'qualify',supplierId:supplier.id,status:'approved',score:95,note:`Validation contre-audit ${token}`});

 // ── A-09 : matrice RBAC lecture ──────────────────────────────────────────
 const qualitySupplies=(await api('QUALITY','GET','/api/suppliers')).data.items;
 const qualitySupplier=qualitySupplies.find(s=>s.id===supplier.id);
 assert(qualitySupplier.materials.every(l=>l.unitPrice===null),'A-09 QUALITY must NOT see supplier prices');
 const qualityOrders=(await api('QUALITY','GET','/api/supplier-orders')).data.items;
 assert(qualityOrders.every(o=>o.lines.every(l=>l.unitPrice===null)),'A-09 QUALITY must NOT see BC prices');
 for(const role of ['QUALITY','INVENTORY','SALES']){
  const r=await raw(role,'GET','/api/purchases');
  assert(r.status===403,`A-09 ${role} must get 403 on purchase requests (got ${r.status})`);
 }
 {const r=await raw('BUYER','GET','/api/purchases');assert(r.status===200,'A-09 BUYER must read purchase requests');}

 // ── A-04 + provisioning : DA → BC → BR avec péremption ───────────────────
 // P5.15.8 : duplicateJustification (plusieurs DA recette sur la même matière)
 // et BC avec justificatif tarifaire (devis attribué, attribution quatre yeux).
 const da1=(await api('BUYER','POST','/api/purchases',{note:`Contre-audit retour/avoir ${token}`,duplicateJustification:`Recette V18.9.1 retour/avoir ${token}`,lines:[{materialId:material.id,qty:12}]})).data.purchase;
 await api('APPROVER','PATCH',`/api/purchases/${da1.id}`,{action:'advance'});
 const upload=pdfUploader(url,u=>users[u]);
 const bc1=(await sourcedOrder({call:api,upload,creator:'BUYER',awarder:'CHIEF',supplierId:supplier.id,requestLineId:da1.lines[0].id,qty:12,unitPrice:price,token:`R1-${token}`,note:token})).order;
 await api('APPROVER','PATCH',`/api/supplier-orders/${bc1.id}`,{action:'approve'});
 const bc1lines=(await api('BUYER','GET','/api/supplier-orders')).data.items.find(o=>o.id===bc1.id).lines;
 // BR : 10 acceptées (péremption 2027), 2 refusées (quarantaine, même péremption).
 await api('RECEIVER','POST','/api/goods-receipts',{supplierOrderId:bc1.id,deliveryRef:`BL-A-${token}`,lines:[{supplierOrderLineId:bc1lines[0].id,acceptedQty:10,rejectedQty:2,lot:token,expiresAt:'2027-01-01'}]});
 let lots=(await api('QUALITY','GET',`/api/stock-lots?materialId=${material.id}`)).data.items;
 const avail1=lots.find(l=>l.lotCode===token&&l.status==='available');
 assert(avail1&&avail1.qty===10,'available lot qty 10');
 assert(avail1.expiresAt&&avail1.expiresAt.startsWith('2027-01-01'),'A-04 available lot carries expiry date');
 // A-04 : rejet qualité partiel → lot quarantaine INCRÉMENTÉ avec les dates
 // d'origine : 2 unités y sont déjà (rejet à la réception) + 2 rejetées par
 // la qualité = 4 en quarantaine, 8 en disponibles.
 await api('QUALITY','POST','/api/quality-inspections',{stockLotId:avail1.id,qty:2,decision:'reject',reason:`Échantillon défectueux contre-audit ${token}`});
 lots=(await api('QUALITY','GET',`/api/stock-lots?materialId=${material.id}`)).data.items;
 const quar=lots.find(l=>l.lotCode===token&&l.status==='quarantine');
 assert(quar&&quar.qty===4,'quarantine lot holds BR-rejected 2 + quality-rejected 2');
 assert(quar.expiresAt&&quar.expiresAt.startsWith('2027-01-01'),'A-04 quarantine transition preserves expiry');
 assert(quar.receivedAt&&Math.abs(new Date(quar.receivedAt).getTime()-new Date(avail1.receivedAt).getTime())<1500,'A-04 quarantine keeps original receivedAt');
 // Libération qualité : retour aux disponibles, dates intactes.
 await api('QUALITY','POST','/api/quality-inspections',{stockLotId:quar.id,qty:2,decision:'release',reason:`Réinspection favorable contre-audit ${token}`});
 lots=(await api('QUALITY','GET',`/api/stock-lots?materialId=${material.id}`)).data.items;
 const availAfter=lots.find(l=>l.lotCode===token&&l.status==='available');
 assert(availAfter.qty===10&&availAfter.expiresAt&&availAfter.expiresAt.startsWith('2027-01-01'),'A-04 release keeps expiry');

 // ── A-02 : facture approuvée → avoir → retour physique ──────────────────
 const receiptLine1=(await api('FINANCE_A','GET','/api/goods-receipts')).data.items.find(g=>g.ref&&g.supplierOrder.id===bc1.id&&g.lines.some(l=>l.lot===token)).lines[0];
 const invA=(await api('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-A-${token}`,invoiceDate:new Date().toISOString().slice(0,10),freightAmount:0,lines:[{receiptLineId:receiptLine1.id,qty:10,unitPrice:price,taxRate:0}]})).data;
 assert(invA.status==='matched','invoice A matched');
 await api('FINANCE_B','PATCH',`/api/supplier-invoices/${invA.id}`,{action:'approve'});
 // Retour sans avoir → refus.
 {const r=await raw('QUALITY','POST','/api/supplier-returns',{stockLotId:availAfter.id,qty:2,reason:`Défaut qualité retour contre-audit ${token}`});
  assert(r.status===409&&r.data.code==='CREDIT_NOTE_REQUIRED','A-02 return without credit must be refused');}
 // Avoir insuffisant (1×price pour 2 unités) → refus au retour.
 const creditSmall=(await api('FINANCE_A','POST','/api/p2p/finance',{action:'credit',invoiceId:invA.id,amount:Number((price).toFixed(2)),reason:`Avoir volontairement insuffisant contre-audit ${token}`})).data.result;
 await api('FINANCE_B','POST','/api/p2p/finance',{action:'approve-credit',creditId:creditSmall.id});
 {const r=await raw('QUALITY','POST','/api/supplier-returns',{stockLotId:availAfter.id,qty:2,reason:`Défaut qualité retour contre-audit ${token}`});
  assert(r.status===409&&r.data.code==='CREDIT_NOTE_REQUIRED','A-02 insufficient credit must be refused');}
 // Avoir complémentaire suffisant, puis retour accepté.
 const credit2=(await api('FINANCE_A','POST','/api/p2p/finance',{action:'credit',invoiceId:invA.id,amount:Number((price).toFixed(2)),reason:`Avoir complémentaire retour contre-audit ${token}`})).data.result;
 await api('FINANCE_B','POST','/api/p2p/finance',{action:'approve-credit',creditId:credit2.id});
 const ret=(await api('QUALITY','POST','/api/supplier-returns',{stockLotId:availAfter.id,qty:2,reason:`Défaut qualité retour contre-audit ${token}`}));
 assert(ret.status===201&&ret.data.creditNotesConsumed>=1,'A-02 credit-backed return accepted, credits consumed');
 // Avoirs bien rattachés au retour.
 const financeState=(await api('FINANCE_B','GET','/api/p2p/finance')).data;
 assert(financeState.credits.filter(c=>c.id===creditSmall.id||c.id===credit2.id).every(c=>c.returnId===ret.data.id),'A-02 credits now linked to the return');
 // Double retour → refus (avoirs consommés).
 {const r=await raw('QUALITY','POST','/api/supplier-returns',{stockLotId:availAfter.id,qty:1,reason:`Tentative double retour contre-audit ${token}`});
  assert(r.status===409&&r.data.code==='CREDIT_NOTE_REQUIRED','A-02 double return must be refused');}
 lots=(await api('QUALITY','GET',`/api/stock-lots?materialId=${material.id}`)).data.items;
 const returnedLot=lots.find(l=>l.lotCode===token&&l.status==='returned');
 assert(returnedLot&&returnedLot.qty===2,'A-02 returned lot recorded');
 assert(returnedLot.expiresAt&&returnedLot.expiresAt.startsWith('2027-01-01'),'A-04 return keeps expiry');

 // ── A-05 + A-06 : facture bloquée, rejet motivé, refacture avec fret ────
 const da2=(await api('BUYER','POST','/api/purchases',{note:`Contre-audit facture bloquée ${token}`,duplicateJustification:`Recette V18.9.1 facture bloquée ${token}`,lines:[{materialId:material.id,qty:4}]})).data.purchase;
 await api('APPROVER','PATCH',`/api/purchases/${da2.id}`,{action:'advance'});
 const bc2=(await sourcedOrder({call:api,upload,creator:'BUYER',awarder:'CHIEF',supplierId:supplier.id,requestLineId:da2.lines[0].id,qty:4,unitPrice:price,token:`R2-${token}`,note:token})).order;
 await api('APPROVER','PATCH',`/api/supplier-orders/${bc2.id}`,{action:'approve'});
 const bc2lines=(await api('BUYER','GET','/api/supplier-orders')).data.items.find(o=>o.id===bc2.id).lines;
 await api('RECEIVER','POST','/api/goods-receipts',{supplierOrderId:bc2.id,deliveryRef:`BL-B-${token}`,lines:[{supplierOrderLineId:bc2lines[0].id,acceptedQty:4,rejectedQty:0,lot:`${token}-B`}]});
 const receiptLine2=(await api('FINANCE_A','GET','/api/goods-receipts')).data.items.find(g=>g.supplierOrder.id===bc2.id).lines[0];
 // Prix erroné (>1 %) → facture bloquée.
 const invB=(await api('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-B-${token}`,invoiceDate:new Date().toISOString().slice(0,10),freightAmount:0,lines:[{receiptLineId:receiptLine2.id,qty:4,unitPrice:Number((price*2).toFixed(4)),taxRate:0}]})).data;
 assert(invB.status==='blocked','A-05 wrong-price invoice must be blocked');
 // Rejet par l'enregistreur lui-même → refus (quatre-yeux).
 {const r=await raw('FINANCE_A','PATCH',`/api/supplier-invoices/${invB.id}`,{action:'reject',reason:`Écart prix fournisseur contre-audit ${token}`});
  assert(r.status===409&&r.data.code==='SELF_REJECTION','A-05 self-rejection refused');}
 // Rejet motivé par un autre comptable.
 const rejected=(await api('FINANCE_B','PATCH',`/api/supplier-invoices/${invB.id}`,{action:'reject',reason:`Écart prix fournisseur, facture annulée par le fournisseur ${token}`},[200]));
 assert(rejected.data.status==='rejected','A-05 invoice rejected');
 // Re-saisie de la facture rectifiée AVEC fret (A-06) sur le même BR : le
 // facturable doit avoir été libéré par le rejet.
 const invC=(await api('FINANCE_B','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-C-${token}`,invoiceDate:new Date().toISOString().slice(0,10),freightAmount:20,lines:[{receiptLineId:receiptLine2.id,qty:4,unitPrice:price,taxRate:0}]})).data;
 assert(invC.status==='matched','A-05 corrected invoice must be matchable after rejection');
 const expectedTotalCents=Math.round(4*price*100)+2000;
 assert(Math.round(Number(invC.totalAmount)*100)===expectedTotalCents,`A-06 total must include freight (${invC.totalAmount})`);
 await api('FINANCE_A','PATCH',`/api/supplier-invoices/${invC.id}`,{action:'approve'});
 // Journal comptable : lignes marchandise + ligne FRET, somme = total facture.
 const journal=(await api('FINANCE_A','GET','/api/p2p/accounting-export')).text.replace(/^\uFEFF/,'');
 // V18.9.2 (contre-audit F01) : le journal se lit PAR NOMS DE COLONNES, jamais
 // par indices codés en dur ; chaque ligne doit avoir EXACTEMENT le nombre de
 // champs de l'en-tête (16 avec « Nature de ligne »).
 const rows=journal.split('\r\n').map(r=>r.split(';').map(c=>c.replace(/^"|"$/g,'').replace(/""/g,'"')));
 const head=rows[0];
 const col=names=>names.map(n=>{const i=head.indexOf(n);assert(i>=0,`A-06 colonne absente : ${n}`);return i;});
 const C=col(['Numéro facture','Nature de ligne','Quantité','Prix HT','Taux taxe %','Base HT','Taxe estimée','TTC estimé']);
 assert(head.length===16,'A-06 header has 16 columns (Nature de ligne added)');
 assert(rows.slice(1).every(r=>r.length===head.length),'A-06 every row matches the header field count');
 const cRows=rows.filter(r=>r.length===head.length&&r[C[0]]===`FAC-C-${token}`);
 assert(cRows.length===2,'A-06 one goods line + one FRET line expected');
 const freightRow=cRows.find(r=>r[C[1]]==='FRET');
 assert(freightRow,'A-06 FRET journal line present');
 assert(freightRow[C[2]]==='1'&&freightRow[C[3]]==='20.0000'&&freightRow[C[4]]==='0.0000','A-06 FRET qty/prix/taux aligned with headers');
 assert(freightRow[C[5]]==='20.00'&&freightRow[C[6]]==='0.00'&&freightRow[C[7]]==='20.00','A-06 FRET HT/taxe/TTC aligned with headers');
 const sumCents=cRows.reduce((s,r)=>s+Math.round(Number(r[C[7]])*100),0);
 assert(sumCents===expectedTotalCents,'A-06 TTC column sums exactly to invoice total');
 // En-têtes de troncature (A-12).
 const journalHeaders=(await raw('FINANCE_A','GET','/api/p2p/accounting-export')).headers;
 assert(journalHeaders.get('x-total-count'),'A-12 X-Total-Count header present');

 // ── A-11 : doublon de numéro → conflit immédiat (pas 5 retries) ─────────
 const t0=Date.now();
 {const r=await raw('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-B-${token}`,invoiceDate:new Date().toISOString().slice(0,10),freightAmount:0,lines:[{receiptLineId:receiptLine2.id,qty:1,unitPrice:price,taxRate:0}]});
  assert(r.status===409,'A-11 duplicate invoice number must conflict');
  const elapsed=Date.now()-t0;
  assert(elapsed<1500,`A-11 definitive P2002 must not be retried (${elapsed} ms)`);
  log.push(`A-11 duplicate rejected in ${elapsed} ms`);}

 // ── A-07 : montant hors entiers sûrs → rejet avant écriture ─────────────
 {const r=await raw('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-X-${token}`,invoiceDate:new Date().toISOString().slice(0,10),freightAmount:0,lines:[{receiptLineId:receiptLine2.id,qty:1000000,unitPrice:1000000000,taxRate:0}]});
  assert(r.status===409&&r.data.code==='AMOUNT_UNSAFE',`A-07 unsafe amount must be refused (${JSON.stringify(r.data).slice(0,200)})`);}

 // ── A-03 : dashboard — clients/montants masqués hors rôles commerciaux ──
 const dashQ=(await api('QUALITY','GET','/api/dashboard')).data;
 assert(dashQ.kpi.pipelineValue===null,'A-03 QUALITY pipelineValue must be null');
 assert(dashQ.upcoming.every(o=>o.client===null&&o.total===null),'A-03 QUALITY sees no client data nor totals');
 const dashS=(await api('SALES','GET','/api/dashboard')).data;
 assert(typeof dashS.kpi.pipelineValue==='number','A-03 SALES pipelineValue must be a number');
 assert(dashS.upcoming.every(o=>o.total===null||typeof o.total==='number'),'A-03 SALES totals typed');

 // ── A-13 : CSP APPLIQUÉE avec nonce par requête (V18.9.2, contre-audit F07) ─
 const page=(await raw('QUALITY','GET','/'));
 const csp=page.headers.get('content-security-policy');
 assert(page.headers.get('content-security-policy-report-only')===null,'A-13 no more Report-Only');
 const nonce=(csp&&csp.match(/nonce-([A-Za-z0-9+/=]+)/)||[])[1];
 assert(csp&&nonce,'A-13 enforcing CSP with per-request nonce');
 assert(csp.includes("strict-dynamic")&&!csp.includes("script-src 'self' 'unsafe-inline'"),'A-13 strict-dynamic without unsafe-inline scripts');
 assert(csp.includes("object-src 'none'")&&csp.includes("frame-ancestors 'none'"),'A-13 object-src/frame-ancestors hardened');
 assert((page.text.match(new RegExp(`nonce="${nonce}"`,'g'))||[]).length>0,'A-13 server HTML scripts carry the nonce');

 console.log(`PASS V18.9.1 contre-audit HTTP: ${log.length} requêtes — A-02/A-03/A-04/A-05/A-06/A-07/A-09/A-11/A-12/A-13 vérifiés`);
})().catch(e=>{console.error('FAIL V18.9.1:',e.message);process.exit(1)});
