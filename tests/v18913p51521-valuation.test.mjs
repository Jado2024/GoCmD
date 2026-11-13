// P5.15.21 (VAL-002) — recette unitaire de la valorisation chronologique
// invoicedCentsForQty. Exécution : node --experimental-strip-types tests/v18913p51521-valuation.test.mjs
import { invoicedCentsForQty } from '../src/lib/invoiced-valuation.ts'

let failures = 0
function check(name, actual, expected) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — obtenu ${actual}, attendu ${expected}`}`)
}

const day = (n) => new Date(`2026-11-${String(n).padStart(2, '0')}T00:00:00Z`)
const line = (id, qty, price, invoiceId, date) => ({ id, qty, unitPrice: price, invoice: { id: invoiceId, invoiceDate: day(date), status: 'matched' } })

// 1. Une seule facture : la valorisation chronologique est identique au
//    calcul direct (aucune régression du cas simple).
check(
  'une seule ligne facturée : valeur = qty × prix',
  invoicedCentsForQty([line(1, 10, 25, 100, 1)], 4),
  Math.round(4 * 25 * 100),
)

// 2. Deux factures à des prix différents, ordre d'entrée INVERSÉ par rapport
//    aux dates : la valorisation suit l'ordre CHRONOLOGIQUE (facture ancienne
//    d'abord), pas l'ordre du tableau. C'est la correction VAL-002 : avant,
//    invoicedLines[0] aurait valu 40 MAD/kg sur tout le retour.
check(
  'deux factures (25 puis 40 MAD/kg), retour 6 kg : 4×25 + 2×40',
  invoicedCentsForQty([line(9, 6, 40, 102, 20), line(1, 4, 25, 100, 1)], 6),
  Math.round(4 * 25 * 100) + Math.round(2 * 40 * 100),
)

// 3. Trois factures, dates identiques : départage par identifiant de facture
//    (déterministe), puis par identifiant de ligne.
check(
  'trois factures, tri stable par identifiant : 2×10 + 1×20 + 1×50',
  invoicedCentsForQty([
    line(31, 1, 50, 103, 5),
    line(11, 1, 20, 102, 5),
    line(5, 2, 10, 101, 5),
  ], 4),
  Math.round(2 * 10 * 100) + Math.round(1 * 20 * 100) + Math.round(1 * 50 * 100),
)

// 4. Retour au-delà du facturé : le reliquat est valorisé au dernier prix
//    facturé connu (règle documentée, cohérente avec le contrôle de couverture).
check(
  'reliquat non facturé au dernier prix connu : 3×25 + 2×40',
  invoicedCentsForQty([line(1, 3, 25, 100, 1), line(2, 5, 40, 101, 10)], 5),
  Math.round(3 * 25 * 100) + Math.round(2 * 40 * 100),
)

// Garde-fous : quantité nulle/négative ou aucune ligne → 0 centime.
check('quantité nulle : 0', invoicedCentsForQty([line(1, 10, 25, 100, 1)], 0), 0)
check('aucune ligne facturée : 0', invoicedCentsForQty([], 5), 0)

if (failures > 0) {
  console.error(`\n${failures} assertion(s) en échec — VAL-002 non démontrée`)
  process.exit(1)
}
console.log('\nVAL-002 démontrée : valorisation chronologique (4 scénarios + 2 gardes)')
