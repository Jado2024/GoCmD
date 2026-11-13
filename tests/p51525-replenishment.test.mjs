import test from 'node:test'
import assert from 'node:assert/strict'
import {calculateReplenishment} from '../src/lib/replenishment-policy.ts'
import {calculateOpenMaterialDemand} from '../src/lib/material-open-demand.ts'
test('No request when projected stock equals minimum',()=>{
 const p=calculateReplenishment({physical:100,reserved:20,unreservedDemand:10,firmInbound:30,minStock:100,targetStock:150,unit:'u'})
 assert.equal(p.projectedQty,100);assert.equal(p.triggered,false);assert.equal(p.suggestedQty,0)
})
test('Full target, subtract reservations and only outstanding demand',()=>{
 const p=calculateReplenishment({physical:40,reserved:10,unreservedDemand:5,firmInbound:20,minStock:60,targetStock:100,unit:'u'})
 assert.equal(p.projectedQty,45);assert.equal(p.suggestedQty,55)
})
test('Fractional quantities are rounded UP to thousandth',()=>{
 const p=calculateReplenishment({physical:1,reserved:0,unreservedDemand:0,firmInbound:0,minStock:2,targetStock:2.45678,unit:'kg'})
 assert.equal(p.suggestedQty,1.457)
})
test('Stock units u are indivisible',()=>{
 const p=calculateReplenishment({physical:4,reserved:0,unreservedDemand:0,firmInbound:0,minStock:5,targetStock:6.2,unit:'u'})
 assert.equal(p.suggestedQty,3)
})
test('Zero threshold disables automated proposals',()=>{
 assert.equal(calculateReplenishment({physical:0,reserved:0,unreservedDemand:0,firmInbound:0,minStock:0,targetStock:100,unit:'u'}).suggestedQty,0)
})
test('No phantom suggestion from committed inbound',()=>{
 assert.equal(calculateReplenishment({physical:10,reserved:0,unreservedDemand:0,firmInbound:100,minStock:40,targetStock:80,unit:'u'}).suggestedQty,0)
})
test('Validation prevents under-target, phantom reservations and negative values',()=>{
 assert.throws(()=>calculateReplenishment({physical:1,reserved:2,unreservedDemand:0,firmInbound:0,minStock:10,targetStock:10,unit:'kg'}),/RESERVED_EXCEEDS_PHYSICAL/)
 assert.throws(()=>calculateReplenishment({physical:1,reserved:0,unreservedDemand:0,firmInbound:0,minStock:10,targetStock:2,unit:'kg'}),/TARGET_BELOW_MIN/)
 assert.throws(()=>calculateReplenishment({physical:-1,reserved:0,unreservedDemand:0,firmInbound:0,minStock:10,targetStock:10,unit:'kg'}),/INVALID_PHYSICAL/)
})

test('Material resale outstanding demand subtracts delivered and reserved once',()=>{
 const orders=[{id:1,materialId:42,qty:10,unitsPerSale:2}]
 const delivery=[{orderLineId:1,qty:3}]
 const reservation=[{orderLineId:1,qty:6}]
 const demand=calculateOpenMaterialDemand(orders,delivery,reservation)
 assert.equal(demand.get(42),8) // (10-3)*2 - 6
 assert.equal(calculateReplenishment({physical:50,reserved:6,unreservedDemand:8,firmInbound:0,minStock:40,targetStock:70,unit:'kg'}).suggestedQty,34)
})
