/** Quantité contrôlée par l'unité de stock ; pas d'arrondi silencieux. */
export const MAX_PURCHASE_QUANTITY = 1_000_000
export const MAX_PURCHASE_LINES = 100
const FRACTIONAL_UNITS = new Set(['kg','g','t','tonne','ml','m','m2','m²','l','litre','litres','m3','m³'])
export function permitsFraction(unit: string): boolean { return FRACTIONAL_UNITS.has(unit.trim().toLocaleLowerCase('fr')) }
export function isValidPurchaseQuantity(qty: number, unit: string): boolean {
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_PURCHASE_QUANTITY) return false
  if (!permitsFraction(unit)) return Number.isSafeInteger(qty)
  return Math.abs(qty * 1000 - Math.round(qty * 1000)) < 0.000001
}
export function parsePurchaseQuantity(draft: string, unit = 'u'): number | null {
  const pattern = permitsFraction(unit) ? /^(?:[0-9]+)(?:[.,][0-9]{1,3})?$/ : /^[0-9]+$/
  if (!pattern.test(draft)) return null
  const number = Number(draft.replace(',', '.'))
  return isValidPurchaseQuantity(number, unit) ? number : null
}
export function buildPurchaseRequestLines(
  lines: ReadonlyArray<{ materialId: number; qtyDraft: string; unit?: string }>,
): Array<{ materialId: number; qty: number }> | null {
  if (lines.length < 1 || lines.length > MAX_PURCHASE_LINES) return null
  const result: Array<{ materialId: number; qty: number }> = []
  const seen = new Set<number>()
  for (const line of lines) {
    const qty = parsePurchaseQuantity(line.qtyDraft, line.unit ?? 'u')
    if (qty === null || !Number.isSafeInteger(line.materialId) || line.materialId < 1 || seen.has(line.materialId)) return null
    seen.add(line.materialId)
    result.push({ materialId: line.materialId, qty })
  }
  return result
}
