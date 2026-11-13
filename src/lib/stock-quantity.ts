/** P5.15.2 — Invariant transversal de quantité par unité de STOCK.
 * Les unités indivisibles (bloc, plaque, pièce, rouleau…) ne se fractionnent jamais.
 * Les unités métriques sont stockées à 3 décimales maximum; aucun arrondi implicite.
 * Aucun Float numérique ne représente un changement d'unité d'achat : la conversion
 * en unité de stock doit être achevée et justifiée avant de franchir les routes.
 */
import { isValidPurchaseQuantity, MAX_PURCHASE_QUANTITY } from './purchase-quantity.ts'

export { MAX_PURCHASE_QUANTITY as MAX_STOCK_QUANTITY }
export function isValidStockQuantity(qty: number, unit: string, allowZero = false): boolean {
  if (allowZero && qty === 0) return true
  return isValidPurchaseQuantity(qty, unit)
}
export function isValidStockDelta(delta: number, unit: string): boolean {
  return isValidStockQuantity(Math.abs(delta), unit, true)
}
/** SODEPI : la mousse agglomérée est fabriquée en interne (GoProd futur). */
export function requiresInternalManufacturing(material: { category: string; foamNature: string | null }): boolean {
  return material.category === 'Mousse' && material.foamNature === 'AGGLO'
}
