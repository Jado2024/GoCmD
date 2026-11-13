// P5.15.23: precision checks for normal priced catalogue / CUMP / returns.
// No new tax/financial rounding rule is introduced by these tests.
import assert from 'node:assert/strict'
import { receivedWeightedAverageCost } from '../src/lib/stock-cost.ts'
import { invoicedCentsForQty } from '../src/lib/invoiced-valuation.ts'
const asLine = (id, qty, price, date) => ({id,qty,unitPrice:price,invoice:{id,invoiceDate:new Date(date),status:'matched'}})
assert.equal(receivedWeightedAverageCost(0,null,5.5,2,17.35),'17.350000')
assert.equal(receivedWeightedAverageCost(6,19.25,5.5,4,19.75),'19.450000')
assert.equal(receivedWeightedAverageCost(3,19.99,5.5,7,20.01),'20.004000')
const items=[asLine(1,1.25,18.40,'2026-11-01'),asLine(2,2.75,20.00,'2026-11-02')]
assert.equal(invoicedCentsForQty(items,4),7800,'1.25x18.40 + 2.75x20 = 78 MAD')
assert.equal(invoicedCentsForQty(items,2.25),4300,'1.25x18.40 + 1x20 = 43 MAD')
assert.equal(invoicedCentsForQty([...items].reverse(),2.25),4300,'tri chronologique stable')
assert.equal(invoicedCentsForQty(items,0),0)
console.log('PASS: 7 vérifications de précision CUMP, centimes et ordre de facturation')
