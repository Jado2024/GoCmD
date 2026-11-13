/** Weighted average unit cost after a positive receipt/release of physical stock.
 * When stock is exhausted, historical averageCost MUST NOT price a new batch.
 * Returns six decimal places, compatible with Prisma Material.averageCost.
 */
export function receivedWeightedAverageCost(
  stockQty: number,
  averageCost: number | null,
  fallbackCost: number,
  incomingQty: number,
  incomingUnitCost: number,
): string {
  if (![stockQty, fallbackCost, incomingQty, incomingUnitCost].every(Number.isFinite) ||
      (averageCost !== null && (!Number.isFinite(averageCost) || averageCost < 0)) ||
      fallbackCost < 0 || incomingQty <= 0 || incomingUnitCost < 0) {
    throw new RangeError("Quantité ou coût invalide pour la valorisation du stock")
  }
  if (stockQty <= 0) return incomingUnitCost.toFixed(6)
  const oldUnitCost = averageCost ?? fallbackCost
  return ((stockQty * oldUnitCost + incomingQty * incomingUnitCost) / (stockQty + incomingQty)).toFixed(6)
}
