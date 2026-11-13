/** CASCADE4-R2 : rôle directeur et permission révocable director.prices sur la file de prix.
 * Test runtime d'identités SQLite sur copie jetable + contrat API/UI. */
import assert from 'node:assert/strict'
import {readFileSync,copyFileSync,mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const directory=require('../src/lib/user-directory.cjs')
const {accessGate,hasPermission,isDirector}=await import('../src/lib/access-gate.ts')
const path='src/app/api/products/route.ts'
const route=readFileSync(new URL('../'+path,import.meta.url),'utf8')
assert.match(route,/if\s*\(\s*!isDirector\(req\)\s*\|\|\s*!hasPermission\(req,\s*["']director\.prices["']\)\s*\)/,'la file exige rôle ET permission')
assert.match(route,/status\s*:\s*403/,'refus HTTP explicite')
const ui=readFileSync(new URL('../src/components/erp/orders-view.tsx',import.meta.url),'utf8')
assert.match(ui,/canDecidePrices=Boolean\([^\n]+director\.prices/,'UI masque la file si permission révoquée')
assert.match(ui,/enabled:canDecidePrices/,'la requête UI est inhibée si permission retirée')
assert.equal(directory.allowed(['director'],{},'director.prices'),true,'rôle directeur autorisé par défaut')
assert.equal(directory.allowed(['director'],{'director.prices':false},'director.prices'),false,'révocation individuelle prioritaire')
assert.equal(directory.allowed(['admin'],{},'director.prices'),false,'administrateur non directeur interdit')
const dbFile=join(mkdtempSync(join(tmpdir(),'gocmd-c4r2-prices-')),'managed.db')
copyFileSync(new URL('../db/custom.db',import.meta.url),dbFile)
const old=process.env.GOCMD_DB_FILE
process.env.GOCMD_DB_FILE=dbFile
try{
 for(const [name,permissions,expected] of [
   ['priceallowed',{},true],
   ['pricerevoked',{'director.prices':false},false],
 ]){
   directory.createUser('c4r2',name,'R2-Initial-Password-2026',['director'],permissions)
   directory.changeOwnPassword(name,'R2-Initial-Password-2026','R2-Updated-Password-2026')
   const {token}=directory.createSession(name)
   const request=new Request('http://127.0.0.1/api/products?pendingPrice=1',{headers:{cookie:`gocmd_session=${token}`}})
   assert.equal(accessGate(request),null,`${name}: session valide`)
   assert.equal(isDirector(request),true,`${name}: rôle directeur conservé`)
   assert.equal(hasPermission(request,'director.prices'),expected,`${name}: état permission attendu`)
 }
}finally{
 if(old===undefined)delete process.env.GOCMD_DB_FILE
 else process.env.GOCMD_DB_FILE=old
}
console.log('PASS C4-R2 : rôle + permission prix, révocation SQLite, contrat API/UI')
