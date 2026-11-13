/* Test moteur P5 exécuté en mémoire sur les fonctions TS transpilées,
 * sans serveur. Les recettes HTTP restent à réaliser avec Prisma réel. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname,'../src/lib/order-duplicate.ts'),'utf8')
const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const fakeString=()=>({regex(){return this},trim(){return this},min(){return this},max(){return this}})
const out={exports:{}}
vm.runInNewContext(js,{exports:out.exports,require:(name)=>name==='zod'?{z:{string:fakeString,object:()=>({strict(){return this}})}}:require(name)}, {filename:'order-duplicate.js'})
const {normalizeCustomerOrderNo,duplicateSignature,lookupOrderDuplicates,duplicateReviewToken,duplicateConflict}=out.exports
assert.equal(normalizeCustomerOrderNo('  bc   2026-01  '),'BC 2026-01')
assert.equal(normalizeCustomerOrderNo('  '),null)
assert.equal(duplicateSignature([{productId:4,qty:3},{productId:2,qty:4},{productId:4,qty:2}]),duplicateSignature([{productId:4,qty:5},{productId:2,qty:4}]))
assert.notEqual(duplicateSignature([{productId:1,qty:2}]),duplicateSignature([{productId:1,qty:3}]))
const req={clientId:7,dueDate:'2026-11-19T00:00:00.000Z',customerOrderNo:'  bc 01  ',lines:[{productId:2,qty:4},{productId:4,qty:5}]}
const prior={id:11,ref:'CMD-11',status:'new',dueDate:new Date(req.dueDate),createdAt:new Date('2026-11-11T00:00:00Z'),lines:[{productId:4,qty:5},{productId:2,qty:4}]}
const tx={order:{
 findUnique:async()=>null,
 findMany:async()=>[prior,{...prior,id:12,ref:'CMD-12',lines:[{productId:4,qty:7}]}],
}}
;(async()=>{
 const check=await lookupOrderDuplicates(tx,req)
 assert.equal(check.existingReference,null)
 assert.equal(check.matches.length,1)
 assert.equal(check.matches[0].ref,'CMD-11')
 assert.equal(check.token,duplicateReviewToken(7,req.dueDate,[11]))
 assert.equal(duplicateConflict(check).code,'DUPLICATE_ORDER_POTENTIAL')
 const exists=await lookupOrderDuplicates({order:{...tx.order,findUnique:async()=>prior}},req)
 assert.equal(duplicateConflict(exists).code,'CUSTOMER_ORDER_NUMBER_EXISTS')
 const no=await lookupOrderDuplicates({order:{findUnique:async()=>null,findMany:async()=>[]}},req)
 assert.equal(no.token,null)
 assert.equal(duplicateConflict(no),null)
 console.log('P5 duplicate logic — 11 assertions PASS')
})().catch(e=>{console.error(e);process.exitCode=1})
