/** P5.15.21 (VAL-002) — valorisation chronologique d'une quantité retournée.
 *
 * Avant : la valeur d'un retour de lot facturé était calculée au prix de la
 * PREMIÈRE ligne de facture trouvée (`invoicedLines[0].unitPrice`), quel que
 * soit le nombre de factures ultérieures à des prix différents — arbitraire
 * et injuste dès qu'un BR est facturé en plusieurs fois (prix négociés,
 * factures rectificatives).
 *
 * Après : chaque tranche retournée est valorisée au prix de la facture qui
 * l'a réellement couverte, dans l'ordre chronologique des factures (date,
 * puis identifiant), puis ordre d'insertion au sein d'une facture. La valeur
 * sert uniquement au contrôle de couverture par avoirs ; aucune écriture
 * comptable n'est modifiée.
 *
 * Quantité au-delà du facturé : valorisée au dernier prix connu (cohérent
 * avec le contrôle de couverture, qui exige un avoir couvrant la valeur).
 */

export type InvoicedValuationLine = {
  id: number
  qty: number
  /** Prisma restitue un Decimal (toNumber), l'API reçoit parfois number/string. */
  unitPrice: number | string | { toNumber(): number }
  invoice: {
    id: number
    invoiceDate: Date | string
    status: string
  }
}

function toNumber(price: InvoicedValuationLine['unitPrice']): number {
  return typeof price === 'object' && price !== null ? price.toNumber() : Number(price)
}

export function invoicedCentsForQty(lines: readonly InvoicedValuationLine[], qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0 || lines.length === 0) return 0
  const ordered = [...lines].sort((a, b) => {
    const da = new Date(a.invoice.invoiceDate).getTime()
    const db = new Date(b.invoice.invoiceDate).getTime()
    return da - db || a.invoice.id - b.invoice.id || a.id - b.id
  })
  let remaining = qty
  let cents = 0
  for (const line of ordered) {
    if (remaining <= 0) break
    const take = Math.min(remaining, line.qty)
    cents += Math.round(take * toNumber(line.unitPrice) * 100)
    remaining = Math.round((remaining - take) * 1000) / 1000
  }
  // Reliquat non facturé : valorisé au dernier prix facturé connu.
  if (remaining > 0) {
    const last = ordered[ordered.length - 1]
    cents += Math.round(remaining * toNumber(last.unitPrice) * 100)
  }
  return cents
}
