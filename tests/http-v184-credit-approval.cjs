#!/usr/bin/env node
/* V18.4 live-HTTP recipe: supplier credits require two distinct finance users.
 * NEVER run on a real database. Only localhost and explicitly isolated copies. */
const fetch=require('./qa-authenticated-fetch.cjs');
const assert=require('node:assert/strict');
if(process.env.GOCMD_E2E_CONFIRM!=='ISOLATED_DB_ONLY')throw new Error('REFUSED: use an isolated copy of db/custom.db');
const base=new URL(process.env.GOCMD_E2E_URL||'http://127.0.0.1:3000');
if(!['localhost','127.0.0.1','::1'].includes(base.hostname))throw new Error('Remote HTTP tests prohibited');
const users={};
for(const role of ['FINANCE_A','FINANCE_B','BUYER','APPROVER','RECEIVER','CHIEF']){
 const username=process.env[`GOCMD_E2E_${role}_NAME`],password=process.env[`GOCMD_E2E_${role}_PASSWORD`];
 if(!username||!password)throw new Error(`Missing test account: ${role}`);
 users[role]={username,password};
}
if(users.FINANCE_A.username===users.FINANCE_B.username)throw Error('Use two distinct finance accounts');
const {pdfUploader,sourcedOrder}=require('./helpers-p2p-setup.cjs');
// Adaptateur vers la signature {status,data} attendue par l'aide de sourcing.
const apiAs=async(role,method,path,body,allowed=[200,201])=>{const r=await request(role,method,path,body,allowed);return {status:r.status,data:r.body}};
const uploadPdf=pdfUploader(base,r=>({name:users[r].username,password:users[r].password}));
let count=0;
async function request(role,method,path,data,allowed=[200,201]){
 const {username,password}=users[role];
 const headers={authorization:'Basic '+Buffer.from(`${username}:${password}`).toString('base64')};
 if(data!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(new URL(path,base),{method,headers,body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'});
 const body=await response.json();count++;
 if(!allowed.includes(response.status))throw Error(`Unexpected HTTP ${response.status}: ${method} ${path}: ${JSON.stringify(body)}`);
 return {status:response.status,body};
}
(async()=>{
 // P5.15.8 : la base de démonstration livrée n'a plus d'historique P2P ;
 // la recette crée sa propre facture approuvée avec solde (chaîne complète
 // moderne : DA → consultation → devis+PDF → attribution quatre yeux → BC
 // → BR → facture approuvée NON réglée).
 const supplies=(await request('BUYER','GET','/api/suppliers')).body.items;
 const supplier=supplies.find(s=>s.active&&s.materials?.length);
 assert(supplier,'Need a referenced supplier on TEST DB');
 const link=supplier.materials.find(l=>l.unitsPerPurchase>0);assert(link);
 const material=link.material;const price=Math.max(0.01,Number(link.unitPrice)||1);
 const token=`V184-${Date.now()}`;
 await request('APPROVER','POST','/api/p2p/sourcing',{action:'qualify',supplierId:supplier.id,status:'approved',score:95,note:`Qualification recette avoir ${token}`});
 const da=(await request('BUYER','POST','/api/purchases',{note:`Avoir fournisseur ${token}`,duplicateJustification:`Recette V18.4 avoir sur besoin dédié ${token}`,lines:[{materialId:material.id,qty:9}]})).body.purchase;
 await request('APPROVER','PATCH',`/api/purchases/${da.id}`,{action:'advance'});
 const bc=(await sourcedOrder({call:apiAs,upload:uploadPdf,creator:'BUYER',awarder:'CHIEF',supplierId:supplier.id,requestLineId:da.lines[0].id,qty:9,unitPrice:price,token,note:token})).order;
 await request('APPROVER','PATCH',`/api/supplier-orders/${bc.id}`,{action:'approve'});
 const bcLines=(await request('BUYER','GET','/api/supplier-orders')).body.items.find(o=>o.id===bc.id).lines;
 await request('RECEIVER','POST','/api/goods-receipts',{supplierOrderId:bc.id,deliveryRef:`BL-${token}`,lines:[{supplierOrderLineId:bcLines[0].id,acceptedQty:9,rejectedQty:0,lot:token}]});
 const rl=(await request('FINANCE_A','GET','/api/goods-receipts')).body.items.find(g=>g.supplierOrder.id===bc.id).lines[0];
 const setupInvoice=(await request('FINANCE_A','POST','/api/supplier-invoices',{supplierId:supplier.id,invoiceNumber:`FAC-AVOIR-${token}`,invoiceDate:new Date().toISOString().slice(0,10),freightAmount:0,lines:[{receiptLineId:rl.id,qty:9,unitPrice:price,taxRate:0}]})).body;
 assert.equal(setupInvoice.status,'matched','setup invoice matched');
 await request('FINANCE_A','PATCH',`/api/supplier-invoices/${setupInvoice.id}`,{action:'approve'},[409]);
 await request('FINANCE_B','PATCH',`/api/supplier-invoices/${setupInvoice.id}`,{action:'approve'});
 const overview=(await request('FINANCE_A','GET','/api/p2p/finance')).body;
 const invoices=(await request('FINANCE_A','GET','/api/supplier-invoices')).body.items;
 const available=overview.balances.find(b=>Number(b.outstanding)>=0.01&&invoices.some(i=>i.id===b.invoiceId&&i.status==='approved'));
 assert(available,'Need an approved supplier invoice with non-zero outstanding on isolated database');
 const invoiceId=available.invoiceId,amount=Number(available.outstanding);
 // New v18.6 invariant: draft credits reserve remaining capacity; a second full draft is refused.
 const prepared=await request('FINANCE_A','POST','/api/p2p/finance',{action:'credit',invoiceId,amount,reason:'Avoir de recette double validation A'});
 const x=prepared.body.result;
 assert.equal(x.status,'draft');
 const duplicate=await request('FINANCE_A','POST','/api/p2p/finance',{action:'credit',invoiceId,amount,reason:'Second avoir de recette incompatible'},[409]);
 assert.equal(duplicate.body.code,'AVOIR_SUPERIEUR_SOLDE');
 let after=(await request('FINANCE_A','GET','/api/p2p/finance')).body;
 assert.equal(after.balances.find(b=>b.invoiceId===invoiceId).outstanding,available.outstanding,'Draft credits must NOT change balance');
 const self=await request('FINANCE_A','POST','/api/p2p/finance',{action:'approve-credit',creditId:x.id},[409]);
 assert.equal(self.body.code,'AVOIR_AUTO_APPROBATION');
 // Draft cancellation is explicitly available to its creator and does not affect balance.
 const cancelled=await request('FINANCE_A','POST','/api/p2p/finance',{action:'cancel-credit',creditId:x.id,reason:'Erreur saisie détectée avant validation'});
 assert.equal(cancelled.body.result.status,'cancelled');
 assert.equal(cancelled.body.result.decisionActor,users.FINANCE_A.username);
 const y=(await request('FINANCE_A','POST','/api/p2p/finance',{action:'credit',invoiceId,amount,reason:'Avoir préparé pour refus indépendant'})).body.result;
 const rejectedSelf=await request('FINANCE_A','POST','/api/p2p/finance',{action:'reject-credit',creditId:y.id,reason:'Annulation directe interdite ici'},[409]);
 assert.equal(rejectedSelf.body.code,'AVOIR_REFUS_PAR_AUTEUR');
 const refused=await request('FINANCE_B','POST','/api/p2p/finance',{action:'reject-credit',creditId:y.id,reason:'Justification insuffisante pour cet avoir'});
 assert.equal(refused.body.result.status,'rejected');
 assert.equal(refused.body.result.decisionReason,'Justification insuffisante pour cet avoir');
 const z=(await request('FINANCE_A','POST','/api/p2p/finance',{action:'credit',invoiceId,amount,reason:'Avoir final approuvé par seconde personne'})).body.result;
 const decided=await request('FINANCE_B','POST','/api/p2p/finance',{action:'approve-credit',creditId:z.id});
 assert.equal(decided.body.result.status,'approved');
 after=(await request('FINANCE_A','GET','/api/p2p/finance')).body;
 assert.equal(after.balances.find(b=>b.invoiceId===invoiceId).outstanding,'0.00','Approved credit must settle exactly');
 await request('FINANCE_B','POST','/api/p2p/finance',{action:'approve-credit',creditId:z.id},[409]);
 const latest=(await request('FINANCE_B','GET','/api/supplier-invoices')).body.items.find(i=>i.id===invoiceId);
 assert.equal(latest.status,'paid','Invoice must be marked paid only after approval of full credit');
 console.log(`PASS HTTP V18.6: ${count} real HTTP requests on isolated DB; draft inert, separate authorizer, no repeat, no over-credit, rejection traced.`);
})().catch(e=>{console.error('FAIL HTTP V18.4',e.stack||e);process.exitCode=1});
