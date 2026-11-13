/** Quantités des DA par matière, sans divulgation de prix.
 * Un BC est compté une seule fois : en brouillon OU restant à recevoir,
 * jamais à la fois dans le reliquat validé et dans le BC.
 */
import { remainingToOrder } from './purchase-availability.ts'

export type DaOrderLine = { qty: number; receivedQty: number; order: { ref: string; status: string } }
export type DaPurchase = {
  id: number; ref: string; status: string; createdAt: Date | string; expectedDate: Date | string | null;
  lines: { id: number; materialId: number; qty: number; approvedQty?: number; receivedQty: number; supplierOrderLines: DaOrderLine[] }[]
}
export type DaHistory = {
  id: number; ref: string; status: string; createdAt: string; expectedDate: string | null;
  qty: number; approvedLineQty: number; approvedToOrderQty: number; draftQty: number; orderedRemainingQty: number;
  acceptedQty: number; draftExcessQty: number; orders: string[]
}
export type DaMaterialSummary = {
  materialId: number; pendingQty: number; approvedQty: number; draftQty: number;
  orderedRemainingQty: number; acceptedQty: number; draftExcessQty: number; history: DaHistory[]
}
export const openDaStatuses = ['pending', 'approved', 'partially_approved', 'ordered', 'partial']
const activeRequest = new Set(openDaStatuses.filter(status => status !== 'pending'))
const safeQty = (n: number) => Number.isFinite(n) && n > 0 ? n : 0
const round = (n: number) => Math.round(n * 1000) / 1000
const iso = (d: Date | string | null) => d === null ? null : new Date(d).toISOString()
export function summarizeMaterialDa(purchases: readonly DaPurchase[]): Record<number, DaMaterialSummary> {
  const result: Record<number, DaMaterialSummary> = {}
  for (const request of purchases) {
    for (const line of request.lines) {
      const materialId = line.materialId
      const summary = result[materialId] ??= {materialId, pendingQty:0, approvedQty:0, draftQty:0, orderedRemainingQty:0, acceptedQty:0, draftExcessQty:0, history:[]}
      // Le serveur et l'interface utilisent EXACTEMENT le même reliquat :
      // les BC clôturés ne réservent pas la partie non livrée ; les brouillons
      // sont de simples projets concurrents, sans engagement de stock.
      const approvedToOrderQty = activeRequest.has(request.status)
        ? remainingToOrder(line) : 0
      const draftQty = activeRequest.has(request.status) ? line.supplierOrderLines
        .filter(orderLine=>orderLine.order.status === 'draft')
        .reduce((sum, orderLine) => sum + Math.max(0,safeQty(orderLine.qty) - safeQty(orderLine.receivedQty)), 0) : 0
      const orderedRemainingQty = activeRequest.has(request.status) ? line.supplierOrderLines
        .filter(orderLine=>['confirmed','partial'].includes(orderLine.order.status))
        .reduce((sum, orderLine) => sum + Math.max(0,safeQty(orderLine.qty) - safeQty(orderLine.receivedQty)), 0) : 0
      const draftExcessQty = Math.max(0, draftQty - approvedToOrderQty)
      const acceptedQty = Math.max(safeQty(line.receivedQty),line.supplierOrderLines.reduce((s,l)=>s+safeQty(l.receivedQty),0))
      const pendingQty = request.status === 'pending' ? safeQty(line.qty) : 0
      summary.pendingQty = round(summary.pendingQty + pendingQty)
      summary.approvedQty = round(summary.approvedQty + approvedToOrderQty)
      summary.draftQty = round(summary.draftQty + draftQty)
      summary.orderedRemainingQty = round(summary.orderedRemainingQty + orderedRemainingQty)
      summary.acceptedQty = round(summary.acceptedQty + acceptedQty)
      summary.draftExcessQty = round(summary.draftExcessQty + draftExcessQty)
      summary.history.push({
        id:request.id,ref:request.ref,status:request.status,createdAt:iso(request.createdAt)!,
        expectedDate:iso(request.expectedDate),qty:round(safeQty(line.qty)),approvedLineQty:round(request.status==='pending'?0:safeQty(line.approvedQty ?? line.qty)),
        approvedToOrderQty:round(approvedToOrderQty),draftQty:round(draftQty),
        orderedRemainingQty:round(orderedRemainingQty),acceptedQty:round(acceptedQty),draftExcessQty:round(draftExcessQty),
        orders:[...new Set(line.supplierOrderLines.map(l=>l.order.ref))],
      })
    }
  }
  for (const summary of Object.values(result)) summary.history.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  return result
}
export function daOpenQty(s:DaMaterialSummary|undefined):number {
  if (!s) return 0
  return round(s.pendingQty+s.approvedQty+s.orderedRemainingQty)
}
export function daAvailableCoverage(s:DaMaterialSummary|undefined):number {
  if(!s)return 0
  // DA en attente et BC brouillon exclus du « confirmé » ; n’ajouter aucun reçu déjà en stock.
  return round(s.approvedQty+s.orderedRemainingQty)
}
