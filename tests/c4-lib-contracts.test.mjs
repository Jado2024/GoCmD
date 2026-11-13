/** C4 — contrats de bibliothèque corrigés par le contre-audit CASCADE4.
 * Exécuté par `npm run test:c4:fixes` (intégré à test:regression:runtime).
 * Modules à imports compatibles node --experimental-strip-types uniquement ;
 * le comportement buildPieces (C4-01) est couvert côté HTTP par
 * tests/c4-counter-audit.test.cjs. */
import assert from 'node:assert/strict'
import { partialLineCredit, allocateInvoiceTax } from '../src/lib/sales-credit-lines.ts'
import { pointOfReorder } from '../src/lib/production-planning-formulas.ts'
import { calculateReplenishment } from '../src/lib/replenishment-policy.ts'
import { centsOf } from '../src/lib/supplier-credit-coverage.ts'

// C4-07 : partialLineCredit refuse NaN et les cas limites restent exacts.
assert.throws(() => partialLineCredit(1000, NaN, 1, 0, 0), /INVALID_CREDIT/, 'NaN originalQty doit être refusé')
assert.throws(() => partialLineCredit(1000, 0, 1e-9, 0, 0), /INVALID_CREDIT/, 'quantité originale nulle doit être refusée')
assert.throws(() => partialLineCredit(1000, 10, 1, 11, 100), /INVALID_CREDIT/, 'quantité déjà créditée supérieure à la quantité originale doit être refusée')
assert.throws(() => partialLineCredit(1000, 10, NaN, 0, 0), /INVALID_CREDIT/, 'NaN newQty doit être refusé')
assert.equal(partialLineCredit(1000, 10, 3, 0, 0), 300)
assert.equal(partialLineCredit(1000, 10, 7, 3, 300), 700, 'dernier crédit = solde exact')
assert.throws(() => partialLineCredit(1000, 10, 8, 3, 300), /CREDIT_QTY_EXCEEDED/)
assert.throws(() => partialLineCredit(500, 10, 3, 0, 400), /CREDIT_AMOUNT_EXCEEDED/)
// C4-07 : allocateInvoiceTax refuse les ids dupliqués et répartit exactement.
assert.throws(() => allocateInvoiceTax([{ id: 1, amountCents: 50, qty: 1 }, { id: 1, amountCents: 50, qty: 1 }], 100, 20), /INVOICE_LINES_MISMATCH/)
const tax = allocateInvoiceTax([{ id: 1, amountCents: 3333, qty: 1 }, { id: 2, amountCents: 6667, qty: 1 }], 10000, 2000)
assert.equal(2000, [...tax.values()].reduce((a, b) => a + b, 0), 'taxe répartie en totalité')
// C4-09 : pointOfReorder sans artefact flottant.
assert.equal(pointOfReorder(0.1, 3, 0), 0.3)
assert.equal(pointOfReorder(0.2, 7, 0), 1.4)
assert.equal(pointOfReorder(1, 3, 0.0000005), 3.000001)
// C4-10 : unités discrètes/inconnues => suggestion entière cohérente avec
// isValidPurchaseQuantity ; unités métriques => 3 décimales.
assert.equal(calculateReplenishment({ physical: 0, reserved: 0, unreservedDemand: 0, firmInbound: 0, minStock: 5, targetStock: 25 / 3, unit: 'carton' }).suggestedQty, 9)
assert.equal(calculateReplenishment({ physical: 1, reserved: 0, unreservedDemand: 0, firmInbound: 0, minStock: 2, targetStock: 2.45678, unit: 'kg' }).suggestedQty, 1.457)
assert.equal(calculateReplenishment({ physical: 4, reserved: 0, unreservedDemand: 0, firmInbound: 0, minStock: 5, targetStock: 6.3333, unit: 'u' }).suggestedQty, 3)
// C4-08 : conversion monétaire fail-closed via moneyToCents.
assert.throws(() => centsOf('0.145'), /Montant/, 'montant à 3 décimales refusé')
assert.throws(() => centsOf('abc'), /Montant/, 'montant non numérique refusé (NaN impossible)')
assert.equal(centsOf('12.34'), 1234)
console.log('PASS C4 contrats lib : partialLineCredit, allocateInvoiceTax, pointOfReorder, calculateReplenishment, centsOf')
