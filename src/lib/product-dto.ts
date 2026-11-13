import type { Prisma } from "@prisma/client"

type Role = "buyer" | "sales" | "approver" | "receiver" | "inventory" | "quality" | "finance" | "admin" | "director" | "production"
export type ActorLike = { username: string; roles: Role[]; legacy: boolean } | null
export type ProductRow = Prisma.ProductGetPayload<Record<string, never>>

/** V18.9.9 (SEC-PROD-01) — les métadonnées internes d'approbation tarifaire
 * (notes internes, prix approuvé enregistré, auteur de la proposition,
 * décideur, motif, numéro de révision) ne sont lisibles que par :
 *  - un compte nominatif directeur (rôle explicite `director`) ;
 *  - le commercial auteur de la proposition (`specialPriceProposedBy`).
 * Le prix de vente autorisé (`unitPrice`, égal au prix approuvé après visa)
 * et le statut du visa restent diffusés : ils sont nécessaires au travail
 * commercial et au blocage serveur des commandes non visées. */
export function maySeeSpecialPriceInternals(actor: ActorLike, product: Pick<ProductRow, "specialPriceProposedBy">): boolean {
  if (!actor || actor.legacy) return false
  if (actor.roles.includes("director")) return true
  return Boolean(product.specialPriceProposedBy && product.specialPriceProposedBy === actor.username)
}

/** DTO produit par permission : conserve les informations commerciales
 * nécessaires (prix de vente autorisé, statut du visa) et masque les
 * données internes de décision pour les rôles non habilités.
 * Le champ est présent avec la valeur null pour que l'API reste stable. */
export function productDtoForActor<T extends ProductRow>(product: T, actor: ActorLike): T {
  if (product.isOrderScoped) return {
    ...product,sku:"HORS CATALOGUE — référence non attribuée",
    model:product.model,
    specialNotes:null,technicalAttributesJson:null,
  }
  if (maySeeSpecialPriceInternals(actor, product) || (actor && !actor.legacy && (actor.roles.includes("director") || ("catalogPriceProposedBy" in product && product.catalogPriceProposedBy===actor.username)))) return product
  return {
    ...product,
    pendingCatalogUnitPrice:null,
    catalogPriceProposedBy:null,
    catalogPriceProposalReason:null,
    catalogPriceProposedAt:null,
    specialNotes: null,
    specialApprovedUnitPrice: null,
    specialPriceProposedBy: null,
    specialPriceApprovedBy: null,
    specialPriceApprovedAt: null,
    specialPriceDecisionReason: null,
    specialPriceRevision: 0,
  }
}

/** V18.9.9 (SEC-PROD-02) — accès aux propositions spéciales non actives.
 * Un produit `pending_validation` ou `rejected` n'est visible QUE par :
 *  - le directeur et l'administrateur (circuit de décision) ;
 *  - le commercial auteur de la proposition ;
 *  - un autre commercial UNIQUEMENT si le tarif a déjà été approuvé
 *    (la référence est alors réutilisable en devis/commande, comme dans
 *    la liste catalogue).
 * Les autres rôles reçoivent 404 : la réponse ne doit pas révéler
 * l'existence d'une proposition confidentielle. */
export function mayReadNonActiveProduct(
  actor: ActorLike,
  product: Pick<ProductRow, "status" | "specialPriceProposedBy" | "specialPriceStatus">,
): boolean {
  if (!actor || actor.legacy) return false
  if (actor.roles.includes("director")) return true
  if (product.specialPriceProposedBy && product.specialPriceProposedBy === actor.username) return true
  return Boolean(
    actor.roles.includes("sales") &&
    product.status === "pending_validation" &&
    product.specialPriceStatus === "approved",
  )
}
