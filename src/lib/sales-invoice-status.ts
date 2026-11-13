/** Compute the client invoice state from cents only (after a posted transaction).
 * Draft/rejected credits MUST be excluded from creditedCents by the caller.
 */
export function salesInvoiceStatus(remainingCents: number, paidCents: number, creditedCents: number): "issued" | "partial" | "paid" | "settled" {
  for (const v of [remainingCents,paidCents,creditedCents]) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error("Invalid invoice cents")
  }
  if (remainingCents === 0) return creditedCents > 0 ? "settled" : "paid"
  return (paidCents > 0 || creditedCents > 0) ? "partial" : "issued"
}
