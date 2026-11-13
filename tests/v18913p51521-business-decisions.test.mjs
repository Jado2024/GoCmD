import assert from 'node:assert/strict'
import {test} from 'node:test'
import {allocateInvoiceTax,partialLineCredit} from '../src/lib/sales-credit-lines.ts'
import {buildClientStatement} from '../src/lib/client-statement.ts'
import {readSalesTaxPolicy,salesTaxAllowed} from '../src/lib/sales-tax-policy.ts'
import {reservationExpiryPolicy} from '../src/lib/reservation-expiry-policy.ts'

test('TVA: aucune valeur implicite, taux autorisés explicites',()=>{
 assert.deepEqual(readSalesTaxPolicy(undefined),[])
 assert.deepEqual(readSalesTaxPolicy('0,2000,2000,700'),[0,700,2000])
 assert.deepEqual(readSalesTaxPolicy('0,invalid'),[])
 assert.equal(salesTaxAllowed(2000,'0,2000'),true)
 assert.equal(salesTaxAllowed(550,'0,2000'),false)
 assert.equal(salesTaxAllowed(0,undefined),false)
})
test('avoirs ligne à ligne: montant TTC conservé et quantité bloquée',()=>{
 const lines=[{id:1,qty:2,amountCents:1999},{id:2,qty:1,amountCents:1000}]
 const alloc=allocateInvoiceTax(lines,2999,600)
 assert.equal([...alloc.values()].reduce((s,n)=>s+n,0),600)
 assert.equal(partialLineCredit(1999,2,1,0,0),1000)
 assert.equal(partialLineCredit(1999,2,1,1,1000),999)
 assert.equal(partialLineCredit(alloc.get(1),2,1,1,Math.round(alloc.get(1)/2)),alloc.get(1)-Math.round(alloc.get(1)/2))
 assert.throws(()=>partialLineCredit(1000,2,1,2,1000),/CREDIT_QTY_EXCEEDED/)
 assert.throws(()=>allocateInvoiceTax(lines,3000,600),/INVOICE_LINES_MISMATCH/)
})
test('état client: factures moins paiements et avoirs validés',()=>{
 const e=[
  {kind:'payment',id:1,invoiceId:1,ref:'R1',invoiceRef:'FAC1',date:'2026-11-03T00:00:00.000Z',amountCents:2000},
  {kind:'credit',id:1,invoiceId:1,ref:'AV1',invoiceRef:'FAC1',date:'2026-11-04T00:00:00.000Z',amountCents:3000},
  {kind:'invoice',id:1,invoiceId:1,ref:'FAC1',invoiceRef:'FAC1',date:'2026-11-01T00:00:00.000Z',amountCents:10000}
 ]
 const full=buildClientStatement(e)
 assert.equal(full.closingBalanceCents,5000)
 assert.deepEqual(full.rows.map(x=>x.balanceCents),[10000,8000,5000])
 const period=buildClientStatement(e,'2026-11-03','2026-11-04')
 assert.equal(period.openingBalanceCents,10000)
 assert.equal(period.closingBalanceCents,5000)
 assert.equal(period.rows.length,2)
 assert.throws(()=>buildClientStatement([...e,{...e[0],id:4,amountCents:-1}]),/INVALID_LEDGER_AMOUNT/)
})
test('réservations: TTL impossible sans configuration explicite',()=>{
 assert.equal(reservationExpiryPolicy(undefined,undefined).configured,false)
 assert.equal(reservationExpiryPolicy('72','12').configured,true)
 assert.equal(reservationExpiryPolicy('72','72').configured,false)
 assert.equal(reservationExpiryPolicy('0','1').configured,false)
})
