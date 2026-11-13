"""P5.14.8 : garde quantités DA (contrat actuel, unités entières et fractionnaires)."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ui=(ROOT/'src/components/erp/purchase-dialog.tsx').read_text()
helper=(ROOT/'src/lib/purchase-quantity.ts').read_text()
route=(ROOT/'src/app/api/purchases/route.ts').read_text()
for fragment in [
 'qtyDraft: string','onChange={e => onChange(e.target.value)}',
 'parsePurchaseQuantity(draft, material.unit) === null',
 'aria-invalid={invalid}', 'aria-describedby={invalid ? helpId : undefined}',
 'role="alert"','buildPurchaseRequestLines(lines.map',
 'submissionLines !== null','disabled={!canSubmit}',
 'if (!canSubmit || submissionLines === null) return',
 'lines: submissionLines,',
 'permitsFraction(material.unit) ? 0.001 : 1',
 'Quantité positive requise',
 ]: assert fragment in ui, f'UX-QTY missing: {fragment}'
for fragment in ['Number.isSafeInteger(qty)','MAX_PURCHASE_QUANTITY = 1_000_000','permitsFraction(unit)','isValidPurchaseQuantity(number, unit)']:
 assert fragment in helper,fragment
assert 'qty: z.number().finite().positive().max(1000000)' in route
assert 'isValidPurchaseQuantity(l.qty,' in route
assert 'onCommit(Math.round(n))' not in ui
print('PASS: UX-QTY actualisé, bloc entier, kg fractionnaire, erreurs ARIA et soumission sécurisée')
