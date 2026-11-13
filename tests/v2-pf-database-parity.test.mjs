import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fixedProductIdentity} from '../src/lib/fixed-product-identity.ts'

test('every fixed PF DEMO SKU and identity matches the server generator exactly',()=>{
 const result=spawnSync('python',['scripts/inspect_pf_v2_identity.py'],{encoding:'utf8',maxBuffer:5*1024*1024})
 assert.equal(result.status,0,result.stderr)
 const rows=JSON.parse(result.stdout)
 assert.ok(rows.length>100)
 let good=0
 for(const row of rows){
  const {canonicalIdentity,sku,...spec}=row
  const coded=fixedProductIdentity(spec)
  assert.equal(coded.identity,canonicalIdentity,`PF ${sku}: canonical identity discrepancy`)
  assert.equal(coded.sku,sku,`PF ${sku}: reference discrepancy`)
  good++
 }
 console.log(`PF generator parity: ${good}/${rows.length}`)
})
