import { stockFree } from './sales-stock-reservation.ts'

export type MaterialSupply = {
  reservedQty: number
  inbound: { ref: string; qty: number; expectedDate: string | null }[]
  /** AUDIT P5.15.27-A (FORM-01) : engagements clients non encore servis
   * (demande de négoce non réservée), alignés sur le moteur de planification
   * (replenishment-policy : position = stock libre − demande + entrées fermes). */
  openDemandQty?: number
}

export function replenishmentPosition(
  material: { stockQty: number; minStock: number },
  supply?: MaterialSupply,
  now = new Date(),
) {
  const freeQty = stockFree(material.stockQty, supply?.reservedQty ?? 0)
  const round = (qty: number) => Math.round(qty * 1000) / 1000
  const inboundQty = round(supply?.inbound.reduce((qty, line) => qty + line.qty, 0) ?? 0)
  const datedQty = round(supply?.inbound.reduce((qty, line) => {
    // Une promesse échue ou sans date ne suffit pas à écarter un risque.
    const date = line.expectedDate?.slice(0, 10)
    return date && date >= now.toISOString().slice(0, 10) ? qty + line.qty : qty
  }, 0) ?? 0)
  const openDemandQty = round(supply?.openDemandQty ?? 0)
  // Position alignée sur le moteur : engagements non servis retranchés.
  const projectedQty = round(freeQty + inboundQty - openDemandQty)
  const remainingGap = round(Math.max(0, material.minStock - projectedQty))
  return { freeQty, inboundQty, openDemandQty, projectedQty, remainingGap, datedQty }
}
