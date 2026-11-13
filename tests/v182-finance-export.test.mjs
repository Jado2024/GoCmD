import assert from 'node:assert/strict'
import { moneyToCents, invoiceBalanceCents } from '../src/lib/supplier-invoice-balance.ts'
import { safeCsvCell } from '../src/lib/export-csv.ts'

// Invoice paid in full: no extra credit may consume a nonexistent balance.
assert.equal(invoiceBalanceCents('825.00', ['820.00'], ['5.00']), 0)
assert.equal(invoiceBalanceCents('100.00', ['80.00'], ['0.00']), 2000)
assert.equal(invoiceBalanceCents('100.00', ['80.00'], ['10.00']), 1000)
assert.equal(invoiceBalanceCents('100.00', [], ['25.55']), 7445)
assert.equal(invoiceBalanceCents('1.00', ['0.10', '0.20'], ['0.30']), 40)
assert.equal(moneyToCents('0.01'), 1)
assert.equal(moneyToCents('1000000000.00'), 100000000000)
assert.equal(moneyToCents(23.5), 2350)
assert.throws(() => moneyToCents('1.001'), RangeError)
assert.throws(() => moneyToCents('1e6'), RangeError)
assert.throws(() => moneyToCents('NaN'), RangeError)
assert.throws(() => moneyToCents(Number.POSITIVE_INFINITY), RangeError)
assert.throws(() => moneyToCents('100000000000000000.00'), RangeError)

for(const injection of ['=1+1', '+SUM(1,1)', '@cmd', '-SUM(1,1)', ' \t=HYPERLINK("http://bad.example")', '\r\n=1+1', '\u0000=1+1']){
  const cell = safeCsvCell(injection)
  assert(cell.startsWith('"'), 'CSV quoting')
  assert(!/\r|\n|\t/.test(cell), 'no embedded separators')
  assert(!/^"\s*[=+@-]/.test(cell), `formula neutralized: ${JSON.stringify(cell)}`)
}
assert.equal(safeCsvCell('Acme "Nord"'), '"Acme ""Nord"""')
assert.equal(safeCsvCell('SODEPI'), '"SODEPI"')
console.log('PASS V18.2: integer-cent invoice balance + CSV injection protection (22 checks)')
