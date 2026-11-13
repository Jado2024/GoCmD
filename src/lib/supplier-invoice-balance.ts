/** Money is stored in decimal MAD. Convert the decimal representation to integer
 * cents before checking invoice coverage: never compare accumulated JS floats.
 */
export type MoneyValue = string | number | { toString(): string }

export function moneyToCents(value: MoneyValue): number {
  const raw = String(value).trim()
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) throw new RangeError("Montant monétaire invalide")
  const negative = raw.startsWith("-")
  const [integer, fractional = ""] = (negative ? raw.slice(1) : raw).split(".")
  const cents = Number(integer) * 100 + Number(fractional.padEnd(2, "0"))
  if (!Number.isSafeInteger(cents)) throw new RangeError("Montant monétaire hors limites")
  return negative ? -cents : cents
}

export function invoiceBalanceCents(total: MoneyValue, payments: MoneyValue[], credits: MoneyValue[]): number {
  return moneyToCents(total) - payments.reduce<number>((sum, value) => sum + moneyToCents(value), 0)
    - credits.reduce<number>((sum, value) => sum + moneyToCents(value), 0)
}

/** Available room for additional payments or draft credits.
 * Draft credits reserve capacity but do not change the legally outstanding balance.
 * Compute this separately from invoiceBalanceCents (which receives approved credits only).
 */
export function invoiceUnreservedCents(
  total: MoneyValue,
  payments: MoneyValue[],
  credits: ReadonlyArray<{ amount: MoneyValue; status: string }>
): number {
  return invoiceBalanceCents(total, payments, credits
    .filter(c => c.status === "draft" || c.status === "approved")
    .map(c => c.amount))
}
