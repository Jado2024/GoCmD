import assert from 'node:assert/strict'
import { MAX_PURCHASE_QUANTITY, MAX_PURCHASE_LINES, parsePurchaseQuantity, buildPurchaseRequestLines } from '../src/lib/purchase-quantity.ts'

const valid = [ ['1',1], ['45',45], ['001',1], ['1000000',1000000] ]
const invalid = ['', '0', '-5', '1.5', '3,5', '1e3', '1e+3', 'NaN', 'Infinity', ' 5', '5 ', '1000001', '9007199254740992', '+2', '2.0', '--1']
for (const [raw, expected] of valid) assert.equal(parsePurchaseQuantity(raw), expected, `valide: ${raw}`)
for (const raw of invalid) assert.equal(parsePurchaseQuantity(raw), null, `invalide: ${raw}`)
assert.equal(MAX_PURCHASE_QUANTITY, 1000000)
assert.equal(MAX_PURCHASE_LINES, 100)
assert.deepEqual(buildPurchaseRequestLines([{materialId:11,qtyDraft:'45'}]), [{materialId:11,qty:45}])
assert.deepEqual(buildPurchaseRequestLines([{materialId:11,qtyDraft:'7'}, {materialId:12,qtyDraft:'9'}]), [
  {materialId:11,qty:7},{materialId:12,qty:9}
])
assert.equal(buildPurchaseRequestLines([]), null)
assert.equal(buildPurchaseRequestLines([{materialId:11,qtyDraft:'7'}, {materialId:12,qtyDraft:'-5'}]), null)
assert.equal(buildPurchaseRequestLines([{materialId:11,qtyDraft:'0'}]), null)
assert.equal(buildPurchaseRequestLines([{materialId:11,qtyDraft:'1.5'}]), null)
assert.equal(buildPurchaseRequestLines([{materialId:11,qtyDraft:''}]), null)
assert.equal(buildPurchaseRequestLines([{materialId:11,qtyDraft:'4'}, {materialId:11,qtyDraft:'5'}]), null)
assert.equal(buildPurchaseRequestLines([{materialId:0,qtyDraft:'4'}]), null)
assert.equal(buildPurchaseRequestLines([{materialId:-1,qtyDraft:'4'}]), null)
assert.equal(buildPurchaseRequestLines(Array.from({length:100},(_,i)=>({materialId:i+1,qtyDraft:'1'})))?.length, 100)
assert.equal(buildPurchaseRequestLines(Array.from({length:101},(_,i)=>({materialId:i+1,qtyDraft:'1'}))), null)
console.log(`PASS: ${valid.length} valeurs valides, ${invalid.length} valeurs invalides et 13 scénarios de payload`)
