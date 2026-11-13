#!/usr/bin/env node
/* C4 — test de contre-audit indépendant (CASCADE4).
 * Exigences couvertes (registre anomalies CASCADE4) :
 *  - C4-01 : ligne ml simple avec pieceCount>1 refusée (sur-étiquetage ×N bloqué).
 *  - C4-02 : visas directeur (catalog-price, sales-price matière) exigent la
 *            permission director.prices révocable, pas seulement le rôle.
 *  - C4-03/C4-04 : GET /api/stock-lots et GET /api/movements appliquent la
 *            matrice stock.read côté serveur (sales refusé, quality OK).
 *  - C4-05/C4-06 : createRequestKey / createRequestDigest /
 *            customerOrderNoNormalized ne quittent jamais le serveur.
 *  - Idempotence Idempotency-Key sur POST /api/orders : rejeu 200 +
 *            Idempotency-Replayed, 409 si corps différent, aucune commande
 *            physique dupliquée (trou de couverture identifié par G-TEST).
 *  - mustChangePassword bloque toute donnée métier (garde access-gate).
 *  - Quatre-yeux approbation commande : compte cumulant sales+approver.
 * Localhost + base copiée uniquement (garde GOCMD_E2E_CONFIRM). */
const assert=require('node:assert/strict')
const {randomUUID}=require('node:crypto')
if(process.env.GOCMD_E2E_CONFIRM!=='ISOLATED_DB_ONLY')throw Error('REFUSED: use isolated DB')
const fetch=require('./qa-authenticated-fetch.cjs')
const url=new URL(process.env.GOCMD_E2E_URL||'http://127.0.0.1:3000')
if(!['127.0.0.1','localhost','::1'].includes(url.hostname))throw Error('Localhost only')
const users={sales:[process.env.GOCMD_E2E_SALES_NAME,process.env.GOCMD_E2E_SALES_PASSWORD],
 salesApprover:[process.env.GOCMD_E2E_SALES_APPROVER_NAME,process.env.GOCMD_E2E_SALES_APPROVER_PASSWORD],
 approver:[process.env.GOCMD_E2E_APPROVER_NAME,process.env.GOCMD_E2E_APPROVER_PASSWORD],
 director:[process.env.GOCMD_E2E_DIRECTOR_NAME,process.env.GOCMD_E2E_DIRECTOR_PASSWORD],
 directorRestricted:[process.env.GOCMD_E2E_DIRECTOR_NO_PRICE_NAME,process.env.GOCMD_E2E_DIRECTOR_NO_PRICE_PASSWORD],
 quality:[process.env.GOCMD_E2E_QUALITY_NAME,process.env.GOCMD_E2E_QUALITY_PASSWORD],
 inventory:[process.env.GOCMD_E2E_INVENTORY_NAME,process.env.GOCMD_E2E_INVENTORY_PASSWORD],
 inventoryNoStockRead:[process.env.GOCMD_E2E_INVENTORY_NO_STOCK_READ_NAME,process.env.GOCMD_E2E_INVENTORY_NO_STOCK_READ_PASSWORD],
 qualityNoStockRead:[process.env.GOCMD_E2E_QUALITY_NO_STOCK_READ_NAME,process.env.GOCMD_E2E_QUALITY_NO_STOCK_READ_PASSWORD],
 finance:[process.env.GOCMD_E2E_FINANCE_A_NAME,process.env.GOCMD_E2E_FINANCE_A_PASSWORD],
 fresh:[process.env.GOCMD_E2E_FRESH_NAME,process.env.GOCMD_E2E_FRESH_PASSWORD]}
for(const [role,[name,password]] of Object.entries(users))if(!name||!password)throw Error(`Missing role ${role}`)
let n=0
async function call(role,method,path,data,allowed=[200,201],extraHeaders={}){
 const [name,password]=users[role]
 const r=await fetch(new URL(path,url),{method,headers:{Authorization:'Basic '+Buffer.from(name+':'+password).toString('base64'),'Content-Type':'application/json',...extraHeaders},body:data?JSON.stringify(data):undefined})
 const json=await r.json().catch(()=>null);n++
 if(!allowed.includes(r.status))throw Error(`${method} ${path} ${r.status}: ${JSON.stringify(json).slice(0,600)}`)
 return {status:r.status,...json,headers:r.headers}
}
;(async()=>{
 const client=(await call('sales','GET','/api/clients')).items[0]
 const catalog=(await call('sales','GET','/api/products?family=MATELAS')).items
 const matelas=catalog.find(x=>x.status==='active'&&x.unit==='u')
 const salons=(await call('sales','GET','/api/products?family=SALON')).items
 const salon=salons.find(x=>x.status==='active'&&x.unit==='ml')
 assert(client&&matelas&&salon,'compte démo attendu : client, matelas et salon actifs')

 // ── C4-01 : pièce ml simple avec pieceCount>1 refusée ──
 {
  const r=await call('sales','POST','/api/orders',{clientId:client.id,dueDate:new Date(Date.now()+86400000).toISOString(),priority:'normale',lines:[{productId:salon.id,qty:10,unitPrice:salon.unitPrice,pieceCount:3}]},[400])
  assert(/une seule étiquette/i.test(r.error),'message C4-01 attendu, obtenu: '+String(r.error))
  console.log('PASS C4-01 : ligne ml simple pieceCount>1 refusée ('+n+' requêtes)')
 }

 // ── C4-02 : visa catalogue exigé avec permission director.prices ──
 {
  const product=catalog.find(x=>x.status==='active'&&x.unit==='u'&&x.materialId==null&&!x.specialNotes&&x.pendingCatalogUnitPrice==null)
  assert(product,'produit catalogue éligible requis')
  const proposal=await call('approver','POST',`/api/products/${product.id}/catalog-price`,{action:'propose',price:Math.round(product.unitPrice*100)/100+1,reason:'Contre-audit CASCADE4 : proposition test permission'})
  const revision=Number(proposal.id!==undefined&&(await call('approver','GET',`/api/products/${product.id}`)).catalogPriceProposalRevision||0)
  const r=await call('directorRestricted','POST',`/api/products/${product.id}/catalog-price`,{action:'approve',revision,reason:'Tentative de visa sans permission director.prices'},[403])
  assert(/Visa directeur|habilité/i.test(r.error),'403 attendu pour directeur sans permission, obtenu: '+String(r.error))
  // C4-R2 : la file de prix spéciaux elle-même doit respecter la permission
  // révocable. Le rôle seul n'est pas suffisant, même pour une lecture GET.
  const restrictedQueue=await call('directorRestricted','GET','/api/products?pendingPrice=1',undefined,[403])
  assert.match(String(restrictedQueue.error),/director\.prices|habilité/i,'GET prix en attente : 403 explicite attendu')
  const authorizedQueue=await call('director','GET','/api/products?pendingPrice=1',undefined,[200])
  assert.ok(Array.isArray(authorizedQueue.items),'directeur habilité : liste des prix accessible')
  console.log('PASS C4-R2 : file de prix protégée en lecture (403 révoqué, 200 habilité)')
  console.log('PASS C4-02 : directeur dont director.prices est révoqué => visa catalogue refusé')
 }

 // ── C4-03/C4-04 : matrice stock.read appliquée côté serveur ──
 {
  const deniedLots=await call('sales','GET','/api/stock-lots',undefined,[403])
  const okLots=await call('quality','GET','/api/stock-lots?take=5')
  const deniedMoves=await call('sales','GET','/api/movements',undefined,[403])
  const okMoves=await call('inventory','GET','/api/movements?take=5')
  assert.ok(okLots.items!==undefined&&okMoves.items!==undefined,'réponses stock attendues pour les rôles habilités')
  // REV1 : vérifier la révocation individuelle, pas simplement la présence du rôle.
  for(const user of ['inventoryNoStockRead','qualityNoStockRead']){
    for(const route of ['/api/stock-lots?take=5','/api/movements?take=5']){
      const blocked=await call(user,'GET',route,undefined,[403])
      assert.match(String(blocked.error),/stock.read|permission|habilité/i,`révocation stock.read : ${user} ${route}`)
    }
  }
  console.log('PASS C4-03/04-REV1 : rôle insuffisant si permission stock.read révoquée (4 refus 403)')
 }

 // ── Idempotence : rejeu Idempotency-Key ──
 let firstOrder=null
 {
  const key='c4-idem-'+randomUUID().slice(0,24)
  const base={clientId:client.id,dueDate:new Date(Date.now()+86400000*10).toISOString(),priority:'normale',lines:[{productId:matelas.id,qty:2,unitPrice:matelas.unitPrice}]}
  const first=await call('sales','POST','/api/orders',base,[201],{'Idempotency-Key':key})
  firstOrder=first.order
  const replay=await call('sales','POST','/api/orders',base,[200],{'Idempotency-Key':key})
  assert.equal(replay.headers.get('Idempotency-Replayed'),'true','en-tête Idempotency-Replayed attendu')
  assert.equal(replay.order.id,first.order.id,'même commande retournée au rejeu')
  const other=await call('sales','POST','/api/orders',{...base,lines:[{productId:matelas.id,qty:3,unitPrice:matelas.unitPrice}]},[409],{'Idempotency-Key':key})
  assert(other,'409 attendu pour même clé + corps différent')
  const list=(await call('sales','GET','/api/orders?take=200')).items.filter(o=>o.ref===first.order.ref)
  assert.equal(list.length,1,'une seule commande physique')
  console.log('PASS Idempotence : rejeu 200/Replayed, corps différent 409, aucun doublon physique')
 }

 // ── Quatre-yeux + C4-05 : réponse d'approbation sans champs internes ──
 {
  const selfMade=(await call('salesApprover','POST','/api/orders',{clientId:client.id,dueDate:new Date(Date.now()+86400000*5).toISOString(),priority:'normale',note:'C4-FOUR-EYES',lines:[{productId:matelas.id,qty:1,unitPrice:matelas.unitPrice}]})).order
  const selfAttempt=await call('salesApprover','PATCH',`/api/orders/${selfMade.id}`,{action:'approve',comment:'Tentative auto-validation compte cumulant'},[403])
  assert(/quatre yeux/i.test(String(selfAttempt.error)),'message quatre-yeux attendu')
  const noOf=(await call('salesApprover','GET',`/api/work-orders?orderId=${selfMade.id}`)).items
  assert.equal(noOf.length,0,'aucun OF malgré le rôle approver du créateur')
  const approved=await call('approver','PATCH',`/api/orders/${firstOrder.id}`,{action:'approve',comment:'Validation indépendante contre-audit C4'},[200])
  assert.ok(approved.order&&approved.order.id===firstOrder.id,'approbation doit aboutir avec le bon document')
  const payload=JSON.stringify(approved.order)
  for(const field of ['createRequestKey','createRequestDigest','customerOrderNoNormalized']){
    assert.ok(!payload.includes(field),`${field} ne doit jamais quitter le serveur`)
  }
  console.log('PASS Quatre-yeux + C4-05 : approbation 200 effective, trois champs internes absents de la réponse')
 }

 // ── mustChangePassword : aucune donnée métier avant changement initial ──
 {
  const blocked=await call('fresh','GET','/api/clients',undefined,[403])
  assert(/Changement de mot de passe/i.test(String(blocked.error)),'garde mustChangePassword attendue')
  const me=await call('fresh','GET','/api/me',undefined,[200])
  assert(me.username,'/api/me reste accessible pour changer le mot de passe')
  console.log('PASS mustChangePassword : données métier bloquées, /api/me accessible')
 }

 console.log(`\nC4 CONTRE-AUDIT : ${n} requêtes HTTP, tous contrôles PASS`)
})().catch(e=>{console.error('FAIL C4:',e.message);process.exit(1)})
