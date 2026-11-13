/** Calcul commun du reliquat d’une ligne de DA, avant création d’une RFQ/consultation/BC.
 * Une réception acceptée compte dans receivedQty. Les BC en cours réservent
 * seulement le restant NON reçu ; BC brouillons et clôturés ne réservent pas.
 * Les mêmes invariants sont vérifiés lors de l’approbation définitive d’un BC.
 */
export type PurchaseAllocationLine = {
 qty: number; receivedQty: number; order: {status: string}
}
export type PurchaseDemandLine = {
 qty: number; approvedQty?: number; receivedQty: number; supplierOrderLines: readonly PurchaseAllocationLine[]
}
const committedStates = new Set(['confirmed', 'partial', 'received']);
function nonnegative(n: number): number {
 return Number.isFinite(n) && n > 0 ? n : 0;
}
export function remainingToOrder(line: PurchaseDemandLine): number {
 const committed = line.supplierOrderLines.reduce((sum, orderLine) =>
  sum + (committedStates.has(orderLine.order.status)
   ? Math.max(0, nonnegative(orderLine.qty) - nonnegative(orderLine.receivedQty)) : 0), 0);
 return Math.max(0, nonnegative(line.approvedQty ?? line.qty) - nonnegative(line.receivedQty) - committed);
}
