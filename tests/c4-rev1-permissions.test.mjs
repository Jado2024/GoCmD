/** CASCADE4-R1: regression contract for stock.read individual revocations.
 * This is a source/permission contract; the HTTP negative cases run via test:http:c4
 * on a built Next.js server with managed SQLite accounts. */
import assert from 'node:assert/strict'
import {readFileSync, copyFileSync, mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const directory=require('../src/lib/user-directory.cjs')
const {accessGate,hasPermission,hasAnyReadRole}=await import('../src/lib/access-gate.ts')
for(const role of ['inventory','quality']){
  assert.equal(directory.allowed([role],{},'stock.read'),true,`${role}: default stock.read`)
  assert.equal(directory.allowed([role],{'stock.read':false},'stock.read'),false,`${role}: explicit revocation`)
}
assert.equal(directory.allowed(['sales'],{},'stock.read'),false,'sales does not gain stock.read')
for(const path of ['src/app/api/stock-lots/route.ts','src/app/api/movements/route.ts']){
  const code=readFileSync(new URL('../'+path,import.meta.url),'utf8')
  assert.match(code,/hasAnyReadRole\(req,\[\.\.\.STOCK_READ_ROLES\]\)/,`${path}: role gate`)
  assert.match(code,/actor\.managed\s*&&\s*!hasPermission\(req,"stock\.read"\)/,`${path}: explicit revoked permission gate`)
}
// Real managed SQLite session on a disposable copy: prove that a role check alone
// grants access while the individual permission correctly denies it.
const filename=join(mkdtempSync(join(tmpdir(),'gocmd-c4r1-rbac-')),'rbac.db')
copyFileSync(new URL('../db/custom.db',import.meta.url),filename)
const old=process.env.GOCMD_DB_FILE
process.env.GOCMD_DB_FILE=filename
try{
  directory.createUser('C4R1_TEST','c4r1inventory','InitialPassword-C4R1-2026',['inventory'],{'stock.read':false})
  directory.changeOwnPassword('c4r1inventory','InitialPassword-C4R1-2026','UpdatedPassword-C4R1-2026')
  const {token}=directory.createSession('c4r1inventory')
  const req=new Request('http://127.0.0.1/api/stock-lots',{headers:{cookie:`gocmd_session=${token}`}})
  assert.equal(accessGate(req),null,'global gate allows the named account')
  assert.equal(hasAnyReadRole(req,['inventory','quality']),true,'role-only check is insufficient')
  assert.equal(hasPermission(req,'stock.read'),false,'individual permission must veto the role')
}finally{
  if(old===undefined)delete process.env.GOCMD_DB_FILE
  else process.env.GOCMD_DB_FILE=old
}
console.log('PASS CASCADE4-R1 : managed-session revocation + role and route guards')
