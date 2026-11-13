#!/usr/bin/env node
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
// TypeScript is a project devDependency, installed by the CI lockfile.
const ts=require('typescript')
const {Module}=require('node:module')
function load(rel){const filename=path.resolve(__dirname,'..',rel);const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);return mod.exports}
const {serializedSQLiteWrite}=load('src/lib/sqlite-write.ts')
const {accessGate}=load('src/lib/access-gate.ts')
const read=f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8')
const basic=(user,password)=>'Basic '+Buffer.from(`${user}:${password}`).toString('base64')
;(async()=>{
 let active=0,peak=0,seq=0
 const tasks=Array.from({length:6},()=>serializedSQLiteWrite(async()=>{
   active++;peak=Math.max(peak,active)
   await new Promise(resolve=>setTimeout(resolve,10))
   const ref=++seq;active--
   return ref
 }))
 const refs=await Promise.all(tasks)
 assert.deepEqual(refs,[1,2,3,4,5,6]);assert.equal(peak,1,'writes serialized within worker')
 let attempts=0
 const recovered=await serializedSQLiteWrite(async()=>{if(++attempts<=2)throw Object.assign(new Error('Prisma timeout'),{code:'P2028'});return 'ok'})
 assert.equal(recovered,'ok');assert.equal(attempts,3,'retry P2028 must work')
 const rolePwd='Valid-test-password-long-2026'
 const crypto=require('node:crypto'),salt=crypto.randomBytes(16).toString('hex')
 process.env.GOCMD_USERS_JSON=JSON.stringify({salesperson:{salt,hash:crypto.scryptSync(rolePwd,Buffer.from(salt,'hex'),32).toString('hex'),roles:['sales']}})
 process.env.GOCMD_ACCESS_PASSWORD=''
 const req=(p)=>new Request('http://localhost:3000/api/orders',{method:'POST',headers:{authorization:basic('salesperson',p)}})
 assert.equal(accessGate(req(rolePwd),'sales'),null,'sales authorized')
 assert.equal(accessGate(req(rolePwd),'buyer')?.status,403,'sales may not make purchases')
 for(let i=0;i<12;i++)accessGate(req('incorrect!'),'sales')
 assert.equal(accessGate(req('incorrect!'),'sales')?.status,429,'rate limit after repeated failures')
 assert.match(read('src/app/api/orders/route.ts'),/const ref = await nextRef\("CMD", "order", tx\)/)
 assert.match(read('src/components/erp/movement-dialog.tsx'),/recommendedLotId/)
 assert.match(read('src/app/api/stock-lots/route.ts'),/expiresFirst/)
 console.log('PASS V12: 6 parallel operations serialized, retry P2028, role sales segregation, 429 rate-limit and FEFO UI/API presence. Not a live HTTP/Prisma load test.')
})().catch(e=>{console.error(e);process.exitCode=1})
