import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {revisePendingPriceSnapshot} from '../src/lib/price-snapshot.ts'

function hash(obj){return createHash('sha256').update(JSON.stringify(obj)).digest('hex')}
for(const kind of ['GENERIC','CATALOG']){
 test(`${kind}: price update preserves all technical details and refreshes SHA-256`,()=>{
  const before={version:2,kind,description:'matelas 180x200',unitPrice:127.50,dimensions:{lengthCm:180,widthCm:200},quantity:4,unit:'u'}
  const after=revisePendingPriceSnapshot(JSON.stringify(before),152.75,hash(before),127.50)
  assert.equal(after.ok,true)
  const obj=JSON.parse(after.json)
  assert.deepEqual({...obj,unitPrice:before.unitPrice},before)
  assert.equal(obj.unitPrice,152.75)
  assert.equal(after.hash,hash(obj))
  assert.notEqual(after.hash,hash(before))
 })
}
test('unsafe snapshots and invalid currency values fail closed',()=>{
 for(const raw of ['{}','[]','{"version":1,"kind":"GENERIC","unitPrice":12}',
  '{broken','{"version":2,"kind":"GENERIC","unitPrice":"12"}']){
  assert.equal(revisePendingPriceSnapshot(raw,15).ok,false)
 }
 for(const price of [-1,0,NaN,Infinity,1.234]){
  assert.equal(revisePendingPriceSnapshot(JSON.stringify({version:2,kind:'CATALOG',unitPrice:12}),price).ok,false)
 }
})

test('tampered snapshots, stale line price and absent hash cannot be silently rewritten',()=>{
 const base={version:2,kind:'CATALOG',unitPrice:19,description:'Article'}
 const source=JSON.stringify(base)
 assert.equal(revisePendingPriceSnapshot(source,20,'1234',19).ok,false)
 assert.equal(revisePendingPriceSnapshot(source,20,null,19).ok,false)
 assert.equal(revisePendingPriceSnapshot(source,20,hash(base),21).ok,false)
 assert.equal(revisePendingPriceSnapshot(source,20,hash(base),19).ok,true)
})
