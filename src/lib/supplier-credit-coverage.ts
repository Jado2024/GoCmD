/** V18.9.2 (contre-audit indépendant F02/F05) : couverture financière des
 * retours fournisseur et rejets qualité portant sur des lots facturés.
 *
 * Principes :
 *  1. Un avoir FOURNISSEUR APPROUVÉ couvre les retours, quelle que soit sa
 *     nature : « balance » (réduction du solde à payer) ou « refund » (avoir
 *     après règlement intégral, créance de remboursement).
 *  2. La consommation d'un avoir est PARTIELLE et traçable : chaque retour
 *     enregistre des affectations SupplierReturnCreditAllocation plafonnées
 *     par avoir. Un avoir de 100 MAD peut couvrir un retour de 20 MAD et
 *     conserver 80 MAD mobilisables pour un retour ultérieur.
 *  3. Tous les montants sont manipulés en centimes entiers (jamais de floats
 *     accumulés), conformément à lib/supplier-invoice-balance.ts.
 * C4-08 (contre-audit CASCADE4) : la conversion passe par le convertisseur
 * unique moneyToCents (regex stricte + arithmétique entière) ; l'ancien
 * Math.round(Number(x)*100) acceptait « 0.145 » (14,5 c), « 1e5 », et
 * produisait un NaN silencieux sur un montant corrompu. */
import { moneyToCents } from "./supplier-invoice-balance.ts"

export type CreditLike = {
  id: number
  amount: string | number | { toString(): string }
  status: string
  kind?: string | null
  version?: number
  returnId?: number | null
  allocations?: ReadonlyArray<{ amountCents: number }>
}

/** Centimes d'un montant décimal MAD : convertisseur unique, fail-closed. */
export function centsOf(amount: CreditLike["amount"]): number {
  return moneyToCents(amount)
}

/** Reste mobilisable d'un avoir approuvé : montant − affectations existantes. */
export function creditRemainingCents(credit: CreditLike): number {
  const allocated = (credit.allocations ?? []).reduce((sum, a) => sum + a.amountCents, 0)
  return centsOf(credit.amount) - allocated
}

/** Couverture totale disponible d'un ensemble d'avoirs (approuvés seulement). */
export function approvedCoverageCents(credits: readonly CreditLike[]): number {
  return credits
    .filter(c => c.status === "approved")
    .reduce((sum, c) => sum + Math.max(0, creditRemainingCents(c)), 0)
}

export type CreditAllocationPlanEntry = {
  creditId: number
  amountCents: number
  /** Garde optimiste lue au moment de la planification (F05). */
  version: number
  /** Premier retour déjà lié à l'avoir (trace historique conservée). */
  returnId: number | null
}

export type CreditAllocationPlan = {
  plan: CreditAllocationPlanEntry[]
  coveredCents: number
}

/** Plan d'affectation glouton (reste le plus grand d'abord) de neededCents
 * sur les avoirs approuvés non épuisés. Ne fait aucune écriture : l'exécution
 * (updateMany version + create) reste à la charge de la transaction appelante. */
export function planCreditAllocation(
  credits: readonly CreditLike[],
  neededCents: number,
): CreditAllocationPlan {
  const pool = credits
    .filter(c => c.status === "approved")
    .map(c => ({ credit: c, remainingCents: creditRemainingCents(c) }))
    .filter(entry => entry.remainingCents > 0)
    .sort((a, b) => b.remainingCents - a.remainingCents)
  let remaining = neededCents
  const plan: CreditAllocationPlanEntry[] = []
  for (const entry of pool) {
    if (remaining <= 0) break
    const take = Math.min(entry.remainingCents, remaining)
    plan.push({
      creditId: entry.credit.id,
      amountCents: take,
      version: entry.credit.version ?? 0,
      returnId: entry.credit.returnId ?? null,
    })
    remaining -= take
  }
  return { plan, coveredCents: neededCents - remaining }
}

/** Inclure Prisma standard d'un avoir avec ses affectations (lecture de couverture). */
export const CREDIT_ALLOCATION_INCLUDE = {
  allocations: { select: { amountCents: true } },
} as const
