/** Authentification/RBAC en exécution Node ; ne remplace pas des tests HTTP sur Next.js. */
import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'
import { accessGate, currentActor, hasAnyReadRole, canSeeMaterialCosts, isDirector, readRoleGate } from '../src/lib/access-gate.ts'
const password='Local-Test-Only-36-characters!!'
const salt=randomBytes(16)
const mk=(roles)=>({salt:salt.toString('hex'),hash:scryptSync(password,salt,32).toString('hex'),roles})
process.env.GOCMD_USERS_JSON=JSON.stringify({receiver:mk(['receiver']),quality:mk(['quality']),buyer:mk(['buyer']),sales:mk(['sales']),finance:mk(['finance']),director:mk(['director']),admin:mk(['admin'])})
process.env.GOCMD_REQUIRE_RBAC='1'
function req(user,pass=password){return new Request('http://127.0.0.1:3000/api/dashboard',{headers:{authorization:'Basic '+Buffer.from(user+':'+pass).toString('base64'),host:'127.0.0.1:3000'}})}
for(const role of ['receiver','quality','sales','director']){
 const r=req(role)
 assert.equal(currentActor(r)?.username,role)
 assert.equal(canSeeMaterialCosts(r),false,'cost privilege leaked to '+role)
 assert.equal(hasAnyReadRole(r,['buyer','finance']),false)
 assert.equal(readRoleGate(r,['buyer','finance'])?.status,403)
}
for(const role of ['buyer','finance']){
 const r=req(role)
 assert.equal(canSeeMaterialCosts(r),true,'cost privilege missing for '+role)
 assert.equal(hasAnyReadRole(r,['buyer','finance']),true)
 assert.equal(readRoleGate(r,['buyer','finance']),null)
}
assert.equal(canSeeMaterialCosts(req('admin')),false,'admin seul ne lit pas les couts');
assert.equal(hasAnyReadRole(req('admin'),['buyer','finance']),false,'admin seul ne lit pas les operations');
assert.equal(readRoleGate(req('admin'),['buyer','finance'])?.status,403);
assert.equal(isDirector(req('director')),true)
assert.equal(isDirector(req('admin')),false)
assert.equal(accessGate(req('receiver')),null)
assert.equal(accessGate(req('receiver','wrong password'))?.status,401)
process.env.GOCMD_USERS_JSON=''
process.env.GOCMD_ACCESS_PASSWORD=password
const legacy=req('gocmd')
assert.equal(currentActor(legacy)?.legacy,true)
assert.equal(canSeeMaterialCosts(legacy),false)
assert.equal(hasAnyReadRole(legacy,['buyer','finance']),false)
assert.equal(readRoleGate(legacy,['buyer','finance'])?.status,403)
assert.equal(isDirector(legacy),false)
console.log('PASS V18.9.8 — 7 profils nominatifs, droits coûts, accès démo restreint, rôle director, mot de passe incorrect')
