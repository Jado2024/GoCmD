#!/usr/bin/env node
/* ONLY localhost + isolated copied database. Seven-stage sales flow, separated sales/finance roles. */
const fetch=require('./qa-authenticated-fetch.cjs');
const assert=require('node:assert/strict')
if(process.env.GOCMD_E2E_CONFIRM!=='ISOLATED_DB_ONLY')throw Error('REFUSED: use isolated DB')
const url=new URL(process.env.GOCMD_E2E_URL||'http://127.0.0.1:3000')
if(!['127.0.0.1','localhost','::1'].includes(url.hostname))throw Error('Localhost only')
const users={sales:[process.env.GOCMD_E2E_SALES_NAME,process.env.GOCMD_E2E_SALES_PASSWORD],finance:[process.env.GOCMD_E2E_FINANCE_A_NAME,process.env.GOCMD_E2E_FINANCE_A_PASSWORD],financeB:[process.env.GOCMD_E2E_FINANCE_B_NAME,process.env.GOCMD_E2E_FINANCE_B_PASSWORD],salesApprover:[process.env.GOCMD_E2E_SALES_APPROVER_NAME,process.env.GOCMD_E2E_SALES_APPROVER_PASSWORD],inventory:[process.env.GOCMD_E2E_INVENTORY_NAME,process.env.GOCMD_E2E_INVENTORY_PASSWORD]}
for(const [role,[name,password]] of Object.entries(users))if(!name||!password)throw Error(`Missing role ${role}`)
let n=0
async function call(role,method,path,data,allowed=[200,201]){
 const [name,password]=users[role]
 const r=await fetch(new URL(path,url),{method,headers:{Authorization:'Basic '+Buffer.from(name+':'+password).toString('base64'),'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined})
 const json=await r.json();n++
 if(!allowed.includes(r.status))throw Error(`${method} ${path} ${r.status}: ${JSON.stringify(json).slice(0,800)}`)
 return {status:r.status,...json}
}
;(async()=>{
 const client=(await call('sales','GET','/api/clients')).items[0]
 const catalog=(await call('sales','GET','/api/products?family=MATELAS')).items
 const product=catalog.find(x=>x.status==='active'&&x.unit==='u')
 assert(client&&product,'Need demo client and active mattress')
 const tag=`SALES-E2E-${Date.now()}`
 const payload={clientId:client.id,dueDate:new Date(Date.now()+14*86400_000).toISOString(),priority:'normale',note:tag,lines:[{productId:product.id,qty:4,unitPrice:product.unitPrice}]}
 const q=(await call('sales','POST','/api/sales',{action:'quote',payload})).quote
 await call('sales','POST','/api/sales',{action:'quote-state',id:q.id,state:'sent'})
 await call('sales','POST','/api/sales',{action:'quote-state',id:q.id,state:'accepted',acceptanceRef:tag})
 const converted=(await call('sales','POST','/api/sales',{action:'convert',id:q.id})).order
 assert.equal(converted.lines[0].pieces.length,4)
 assert.equal(converted.status,'pending_validation','devis converti : commande à approuver');
 assert.equal((await call('sales','GET',`/api/work-orders?orderId=${converted.id}`)).items.length,0,'aucun OF avant approbation');
 await call('sales','PATCH',`/api/orders/${converted.id}`,{action:'approve',comment:'Auto-validation interdite'},[403]);
 // CASCADE3 (audit de mutation M1) : la garde QUATRE-YEUX (créateur ≠ validateur)
 // doit être couverte indépendamment de la porte de rôle. Un compte cumulant
 // les rôles sales+approver crée une commande PUIS tente de la valider
 // lui-même : la porte de rôle ne s'y oppose pas, seule la garde quatre-yeux
 // peut refuser — réponse 403 avec le message dédié.
 {
  const selfMade=(await call('salesApprover','POST','/api/orders',{clientId:client.id,dueDate:new Date(Date.now()+14*86400_000).toISOString(),priority:'normale',note:tag+'-SELFREVIEW',lines:[{productId:product.id,qty:1,unitPrice:product.unitPrice}]})).order
  assert.equal(selfMade.status,'pending_validation','commande du compte cumulant sales+approver : validation requise')
  const selfAttempt=await call('salesApprover','PATCH',`/api/orders/${selfMade.id}`,{action:'approve',comment:'Tentative auto-validation par un compte cumulant sales+approver'},[403])
  assert(/quatre yeux/i.test(String(selfAttempt.error||'')),'message quatre-yeux attendu, obtenu: '+String(selfAttempt.error).slice(0,160))
  assert.equal((await call('salesApprover','GET',`/api/work-orders?orderId=${selfMade.id}`)).items.length,0,'aucun OF malgré le rôle approver du créateur')
 }
 const approved=(await call('salesApprover','PATCH',`/api/orders/${converted.id}`,{action:'approve',comment:'Validation indépendante commande issue du devis'})).order;
 assert.equal(approved.status,'new','commande approuvée par responsable distinct');

 await call('sales','POST','/api/sales',{action:'convert',id:q.id},[409])
 // OF de préparation automatique après confirmation de CMD, sans seconde approbation.
 const wos=(await call('sales','GET',`/api/work-orders?orderId=${converted.id}`)).items
 assert.equal(wos.length,1,'Une ligne commerciale = un OF automatique')
 assert.equal(wos[0].status,'approved','OF actif après commande autorisée')
 assert.equal(wos[0].orderLineId,converted.lines[0].id,'OF lié à la ligne')
 assert.equal(wos[0].totalPieces,4,'Quatre étiquettes matelas')
 assert.equal(wos[0].snapshot.pieces.length,4,'Quatre pièces dans le snapshot')
 // Seul le magasinier peut préparer ; le commercial et l'approbateur seuls sont refusés.
 await call('sales','PATCH',`/api/work-orders/${wos[0].id}`,{action:'start'},[403])
 await call('salesApprover','PATCH',`/api/work-orders/${wos[0].id}`,{action:'start'},[403])
 await call('inventory','PATCH',`/api/work-orders/${wos[0].id}`,{action:'start'})
 await call('inventory','PATCH',`/api/work-orders/${wos[0].id}`,{action:'complete'})
 await call('sales','PATCH',`/api/orders/${converted.id}`,{action:'advance'})
 await call('sales','PATCH',`/api/orders/${converted.id}`,{action:'advance'})
 const pieces=converted.lines[0].pieces.map(p=>p.id)
 await call('sales','PATCH',`/api/orders/${converted.id}`,{action:'advance'},[409])
 const d1=(await call('sales','POST','/api/sales',{action:'delivery',orderId:converted.id,pieceIds:pieces.slice(0,2)})).delivery
 await call('sales','POST','/api/sales',{action:'delivery',orderId:converted.id,pieceIds:pieces.slice(0,2)},[409])
 // Regression: two concurrent deliveries with overlapping piece IDs MUST NOT both succeed.
 const overlapping={action:'delivery',orderId:converted.id,pieceIds:pieces.slice(2)}
 const simultaneous=await Promise.all([
   call('sales','POST','/api/sales',overlapping,[201,409]),
   call('sales','POST','/api/sales',overlapping,[201,409]),
 ])
 assert.deepEqual(simultaneous.map(r=>r.status).sort((a,b)=>a-b),[201,409],
   'Exactly one concurrent delivery may consume a given physical piece')
 const d2=simultaneous.find(r=>r.status===201)?.delivery
 assert(d2?.id,'Concurrent delivery winner must provide a real delivery reference')
 const delivered=(await call('sales','GET','/api/sales?type=deliveries&take=100')).items
 const forOrder=delivered.filter(d=>d.orderId===converted.id)
 assert.equal(forOrder.length,2,'Only two BL must exist for the four pieces')
 const pieceIdsDelivered=forOrder.flatMap(d=>d.lines.flatMap(l=>JSON.parse(l.pieceIds)))
 assert.equal(pieceIdsDelivered.length,4,'All four physical pieces were delivered')
 assert.equal(new Set(pieceIdsDelivered).size,4,'No physical piece may be delivered twice')
 const inv=(await call('finance','POST','/api/sales',{action:'invoice',orderId:converted.id,deliveryIds:[d1.id,d2.id],taxRateBps:0})).invoice
 assert.equal(inv.totalCents,Math.round(product.unitPrice*400))
 await call('finance','POST','/api/sales',{action:'invoice',orderId:converted.id,deliveryIds:[d1.id,d2.id],taxRateBps:0},[409])
 const pending=(await call('finance','POST','/api/sales',{action:'credit',invoiceId:inv.id,amountCents:14000,reason:'Retour de démonstration'})).credit
 assert.equal(pending.status,'draft')
 await call('finance','POST','/api/sales',{action:'approve-credit',creditId:pending.id},[409])
 await call('financeB','POST','/api/sales',{action:'approve-credit',creditId:pending.id})
 // P5.15.21 (SEP-002) : quatre-yeux financiers — l'émetteur de la facture
 // (finance) ne peut pas encaisser son propre règlement (403 attendu) ;
 // l'encaissement valide est porté par le second compte finance.
 await call('finance','POST','/api/sales',{action:'payment',invoiceId:inv.id,amountCents:Math.round(product.unitPrice*400)-14000,reference:tag+'-PAY',method:'virement'},[403])
 await call('financeB','POST','/api/sales',{action:'payment',invoiceId:inv.id,amountCents:Math.round(product.unitPrice*400)-14000,reference:tag+'-PAY',method:'virement'})
 const view=(await call('finance','GET','/api/sales?type=invoices')).items.find(x=>x.id===inv.id)
 assert.equal(view.status,'settled', 'Part-payment plus credit note settles, but does not fully pay, an invoice')
 assert.equal(view.payments[0].amountCents,Math.round(product.unitPrice*400)-14000)
 assert.equal(view.credits[0].amountCents,14000)
 assert.equal(view.totalCents-view.payments.reduce((s,p)=>s+p.amountCents,0)-view.credits.filter(c=>c.status==='approved').reduce((s,c)=>s+c.amountCents,0),0)
 console.log(`PASS HTTP SALES: ${n} requêtes, devis, acceptation, commande, OF auto-approuvé et préparé par magasinier, BL partiels, double livraison refusée en séquentiel et en parallèle, facture unique, avoir, paiement, statut settled ; isolé`)
})().catch(e=>{console.error('FAIL HTTP SALES:',e);process.exitCode=1})
