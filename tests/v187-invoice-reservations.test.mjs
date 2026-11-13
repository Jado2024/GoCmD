import assert from 'node:assert/strict'
import { invoiceBalanceCents, invoiceUnreservedCents } from '../src/lib/supplier-invoice-balance.ts'
// Base: invoice 1000, with no payments or credits.
assert.equal(invoiceUnreservedCents('1000.00',[],[]),100000)
assert.equal(invoiceBalanceCents('1000.00',[],[]),100000)
// Draft 800 reserves capacity but must NOT be deducted from accounting balance.
const draft=[{amount:'800.00',status:'draft'}]
assert.equal(invoiceBalanceCents('1000.00',[],draft.filter(c=>c.status==='approved').map(c=>c.amount)),100000)
assert.equal(invoiceUnreservedCents('1000.00',[],draft),20000)
assert.equal(invoiceUnreservedCents('1000.00',['150.00'],draft),5000)
assert.equal(invoiceUnreservedCents('1000.00',['200.00'],draft),0)
// An approved credit consumes balance; rejected and cancelled do not.
const credits=[{amount:'300.00',status:'approved'},{amount:'150.00',status:'draft'},{amount:'400.00',status:'rejected'},{amount:'50.00',status:'cancelled'}]
assert.equal(invoiceUnreservedCents('1000.00',['100.00'],credits),45000)
assert.equal(invoiceBalanceCents('1000.00',['100.00'],credits.filter(c=>c.status==='approved').map(c=>c.amount)),60000)
// Precision and invalid values.
assert.equal(invoiceUnreservedCents('10.01',['0.01'],[{amount:'0.02',status:'draft'}]),998)
assert.throws(()=>invoiceUnreservedCents('1.00',[],[{amount:'0.001',status:'draft'}]), /Montant monétaire invalide/)
console.log('PASS V18.7: 9 genuine financial capacity cases, including draft reservation/payment conflict')
