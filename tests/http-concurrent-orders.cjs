#!/usr/bin/env node
/* NEVER execute against live DB. Requires dedicated isolated SQLite test copy. */
const fetch=require('./qa-authenticated-fetch.cjs');
const assert=require('node:assert/strict')
if(process.env.GOCMD_E2E_CONFIRM!=='ISOLATED_DB_ONLY')throw Error('REFUSED: requires isolated DB acknowledgement')
const base=new URL(process.env.GOCMD_E2E_URL||'http://127.0.0.1:3000')
if(!['localhost','127.0.0.1','::1'].includes(base.hostname))throw Error('Only localhost is permitted')
const user=process.env.GOCMD_E2E_SALES_NAME,password=process.env.GOCMD_E2E_SALES_PASSWORD
if(!user||!password)throw Error('Set dedicated sales-role test credentials')
const header='Basic '+Buffer.from(`${user}:${password}`).toString('base64')
async function api(method,path,body){const response=await fetch(new URL(path,base),{method,headers:{Authorization:header,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(`${response.status} ${path}: ${JSON.stringify(data).slice(0,350)}`);return data}
// P6 (2026-11-11) : renvoie statut + corps sans lever, pour les phases où un
// refus métier 409 est le résultat ATTENDU (contrat doublons P5.15.29-P5).
async function raw(method,path,body){const response=await fetch(new URL(path,base),{method,headers:{Authorization:header,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let data=null;try{data=await response.json()}catch{};return {status:response.status,data}}
;(async()=>{
 const clients=(await api('GET','/api/clients')).items
 const products=(await api('GET','/api/products?family=MATELAS')).items
 const product=products.find(p=>p.status==='active'&&p.unit==='u')
 assert(clients.length&&product,'Need test client + active mattress')
 const line0={productId:product.id,qty:1,unitPrice:Math.max(1,Number(product.unitPrice)||1)}
 const inDays=(d)=>new Date(Date.now()+d*86400_000).toISOString()

 // ── Phase 1 : 3 commandes DISTINCTES (quantités 1,2,3) créées concurremment.
 // Intention d'origine du test : l'allocation concurrente de références ne
 // doit produire ni collision, ni erreur serveur, ni écriture partielle.
 const distinct=await Promise.allSettled(Array.from({length:3},(_,i)=>api('POST','/api/orders',{clientId:clients[0].id,dueDate:inDays(7),priority:'normale',note:`RECETTE-CONCURRENCE-${Date.now()}-${i}`,lines:[{...line0,qty:i+1}]})))
 const successes=distinct.filter(x=>x.status==='fulfilled').map(x=>x.value.order)
 const errors=distinct.filter(x=>x.status==='rejected').map(x=>String(x.reason))
 assert.equal(successes.length,3,`3 distinct creates must succeed; failures: ${errors.join(' | ')}`)
 assert.equal(new Set(successes.map(o=>o.ref)).size,3,'All refs must be unique')

 // ── Phase 2 (P5) : 3 commandes STRICTEMENT identiques tirées concurremment,
 // sans jeton de revue. Exactement 1 doit passer ; les 2 autres doivent être
 // refusées 409 DUPLICATE_ORDER_POTENTIAL : le contrôle serveur n'est pas
 // contournable par concurrence (la garde est dans la même transaction).
 const identical=await Promise.allSettled(Array.from({length:3},(_,i)=>api('POST','/api/orders',{clientId:clients[0].id,dueDate:inDays(8),priority:'normale',note:`RECETTE-DOUBLON-${Date.now()}-${i}`,lines:[line0]})))
 const ok2=identical.filter(x=>x.status==='fulfilled').map(x=>x.value.order)
 const dup2=identical.filter(x=>x.status==='rejected'&&String(x.reason).includes('DUPLICATE_ORDER_POTENTIAL'))
 assert.equal(ok2.length,1,`exactement 1 création identique doit réussir, obtenu ${ok2.length} : ${identical.filter(x=>x.status==='rejected').map(x=>String(x.reason)).join(' | ')}`)
 assert.equal(dup2.length,2,'les 2 autres doivent être refusées comme doublon potentiel (409)')
 assert(dup2.every(x=>{const m=/token":"([a-f0-9]{64})"/.exec(String(x.reason));return m&&m[1]}),'chaque refus doublon doit exposer un jeton de revue')

 // ── Phase 3 (P5) : une commande similaire CONFIRMÉE avec motif et jeton
 // valides est autorisée — deux commandes volontairement identiques ne sont
 // jamais confondues avec une répétition technique.
 const token=(/token":"([a-f0-9]{64})"/.exec(String(dup2[0].reason))||[])[1]
 const confirmed=await raw('POST','/api/orders',{clientId:clients[0].id,dueDate:inDays(8),priority:'normale',note:'RECETTE-DOUBLON-CONFIRME',lines:[line0],duplicateReview:{token,reason:'Commande volontairement identique confirmée — recette concurrence P6'}})
 assert([200,201].includes(confirmed.status),`confirmation justifiée attendue 200/201, obtenu ${confirmed.status} ${JSON.stringify(confirmed.data).slice(0,220)}`)
 assert(confirmed.data&&confirmed.data.order&&confirmed.data.order.ref,'commande confirmée créée avec référence')

 // ── Phase 4 (P5) : le jeton de la phase 2 est désormais PÉRIMÉ (l'ensemble
 // des commandes similaires a changé) : sa réutilisation doit être refusée,
 // jamais silencieusement acceptée.
 const stale=await raw('POST','/api/orders',{clientId:clients[0].id,dueDate:inDays(8),priority:'normale',note:'RECETTE-DOUBLON-JETON-PERIME',lines:[line0],duplicateReview:{token,reason:'Réutilisation interdite d un jeton de revue périmé'}})
 assert.equal(stale.status,409,`jeton périmé doit être refusé 409, obtenu ${stale.status}`)
 assert(stale.data&&(stale.data.code==='DUPLICATE_ORDER_POTENTIAL'||stale.data.code==='DUPLICATE_REVIEW_STALE'),'refus avec code doublon attendu, obtenu '+JSON.stringify(stale.data).slice(0,160))

 console.log('PASS HTTP CONCURRENCE: 3/3 distinctes (références uniques) + garde doublons P5 sous concurrence (1/3, 2 refus 409 justifiés) + confirmation motivée acceptée + jeton périmé refusé. Base de TEST isolée.')
})().catch(e=>{console.error('FAIL HTTP CONCURRENCE',e);process.exitCode=1})
