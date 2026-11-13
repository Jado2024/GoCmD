/** R8 fresh audit: true managed SQLite sessions for supplier exception permissions.
 * No HTTP server required: validates the global gate and the per-action permissions.
 */
import assert from 'node:assert/strict'
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const directory=require('../src/lib/user-directory.cjs')
const {accessGate,hasPermission,hasRole}=await import('../src/lib/access-gate.ts')
const folder=mkdtempSync(join(tmpdir(),'gocmd-r8-supplier-'))
const file=join(folder,'copy.db')
copyFileSync(new URL('../db/custom.db',import.meta.url),file)
const original=process.env.GOCMD_DB_FILE
process.env.GOCMD_DB_FILE=file
let count=0
try{
 const scenarios=[
  ['r8buyer',['buyer'],{},'buyer','suppliers.manage',true],
  ['r8approver',['approver'],{},'approver','purchases.approve',true],
  ['r8buyerdeny',['buyer'],{'suppliers.manage':false},'buyer','suppliers.manage',false],
  ['r8approverdeny',['approver'],{'purchases.approve':false},'approver','purchases.approve',false],
 ]
 for(const [username,roles,permissions,role,right,allowed] of scenarios){
   directory.createUser('R8',username,'TemporaryPassword-R8-2026',roles,permissions)
   directory.changeOwnPassword(username,'TemporaryPassword-R8-2026','ChangedPassword-R8-2026')
   const session=directory.createSession(username)
   const req=new Request('http://127.0.0.1:3000/api/suppliers',{method:'POST',headers:{cookie:`gocmd_session=${session.token}`,origin:'http://127.0.0.1:3000',host:'127.0.0.1:3000'}})
   assert.equal(accessGate(req,role),null,`${username} must pass global gate for its assigned role`)
   assert.equal(hasRole(req,role),true)
   assert.equal(hasPermission(req,right),allowed,`${username} per-action right`)
   assert.equal(hasPermission(req,right==='suppliers.manage'?'purchases.approve':'suppliers.manage'),false,`${username} must not inherit other right`)
   count+=4
 }
 const src=(await import('node:fs')).readFileSync(new URL('../src/app/api/suppliers/route.ts',import.meta.url),'utf8')
 assert.match(src,/request\.actor===actor\)throw Error\("FOUR_EYES_REQUIRED"\)/)
 assert.match(src,/hasPermission\(req,"purchases\.approve"\)/)
 assert.match(src,/hasPermission\(req,"suppliers\.manage"\)/)
 count+=3
} finally {
 if(original===undefined)delete process.env.GOCMD_DB_FILE
 else process.env.GOCMD_DB_FILE=original
 rmSync(folder,{recursive:true,force:true})
}
console.log(`PASS R8: ${count} managed-session RBAC and four-eyes contract checks`)
