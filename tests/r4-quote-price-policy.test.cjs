'use strict'
/** R4 pure-code regression: executes the actual TS quote policy via TypeScript transpile.
 * Does NOT simulate Next.js routes, RBAC sessions or browser flows. */
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const Module=require('node:module')
const ts=require('typescript')
function loadTS(filename){
  const file=path.resolve(__dirname,'../src/lib/',filename+'.ts')
  const source=fs.readFileSync(file,'utf8')
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const mod=new Module(file,module)
  mod.filename=file
  mod.paths=Module._nodeModulePaths(path.dirname(file))
  const native=mod.require.bind(mod)
  mod.require=(name)=>name.startsWith('./')?loadTS(name.slice(2)):native(name)
  mod._compile(output,file)
  return mod.exports
}
const {quoteLineDigest,createQuotePricePlan,quoteReviewPlan,quoteLineVisaValid,readQuoteVisas}=loadTS('quote-line-prices')
const normal={productId:12,qty:3,unitPrice:150}
const special={productId:-1,qty:2,unitPrice:240,generic:{template:'GEN-MAT',description:'Matelas sur mesure 190x210'}}
const other={productId:-2,qty:1,unitPrice:330,generic:{template:'GEN-DIV',description:'Pièce sur mesure'}}
const product={id:12,unitPrice:150,specialNotes:null}

test('quote stores per-line eligibility and original catalogue prices',()=>{
 const lines=[normal,special,other]
 const plan=createQuotePricePlan(lines,new Map([[12,product]]))
 assert.deepEqual(plan.map(x=>x.required),[false,true,true])
 assert.deepEqual(plan.map(x=>x.catalogPrice),[150,null,null])
 product.unitPrice=175 // catalogue price changes after the quote: approval plan must remain fixed
 assert.deepEqual(quoteReviewPlan(JSON.stringify(plan),lines),plan)
 product.unitPrice=150
})
test('two generic line visas are independent',()=>{
 const now='2026-11-11T22:00:00.000Z'
 const visas={'1':{by:'director',at:now,reason:'Accord exceptionnel',digest:quoteLineDigest(special)}}
 assert.equal(quoteLineVisaValid(visas,1,special),true)
 assert.equal(quoteLineVisaValid(visas,2,other),false)
 assert.equal(quoteLineVisaValid(visas,1,{...special,unitPrice:245}),false)
 assert.equal(quoteLineVisaValid(visas,1,{...special,generic:{...special.generic,description:'Autre configuration'}}),false)
 assert.equal(quoteLineVisaValid(readQuoteVisas(JSON.stringify(visas)),1,special),true)
})
test('tampered or legacy price plans fail closed',()=>{
 const lines=[special]
 const plan=createQuotePricePlan(lines,new Map())
 for(const raw of [null,'[]','{}','{broken',JSON.stringify([{...plan[0],digest:'fake'}])])
  assert.throws(()=>quoteReviewPlan(raw,lines))
 assert.throws(()=>quoteReviewPlan(JSON.stringify(plan),[{...special,unitPrice:241}]))
})
test('supplier exception key never collides with canonical lookup',()=>{
 const {supplierLookupKey,approvedSupplierExceptionKey,normalizeSupplierSku}=loadTS('supplier-sku-identity')
 assert.equal(normalizeSupplierSku('  00-a/7   '),'00-A/7')
 assert.equal(supplierLookupKey(4,'00-a/7'),'4#00-A/7')
 assert.notEqual(approvedSupplierExceptionKey(4,'00-a/7',18),supplierLookupKey(4,'00-a/7'))
 assert.notEqual(approvedSupplierExceptionKey(4,'00-a/7',18),approvedSupplierExceptionKey(4,'00-a/7',19))
})
