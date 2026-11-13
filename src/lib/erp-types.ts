// Types partagés client/serveur pour GoCmd
// (aucun import serveur — utilisable côté navigateur)

export type MaterialCategory = "Mousse" | "Tissu" | "Mercerie" | "Emballage & consommables"
export type MovementType = "in" | "out" | "production" | "adjust"
export type OrderStatus = "pending_validation" | "rejected" | "new" | "production" | "ready" | "shipped"
export type OrderPriority = "normale" | "haute"
export type PurchaseStatus = "pending" | "approved" | "partially_approved" | "rejected" | "ordered" | "partial" | "received" | "closed" | "cancelled"

export interface MaterialDTO {
  id: number
  ref: string
  name: string
  category: MaterialCategory | string
  unit: string
  // V18.9.2 (contre-audit F03) : null quand les coûts matières sont masqués
  // pour le rôle appelant (hors achats/approbation/finances/admin).
  unitPrice: number | null
  foamNature?: "PURE"|"AGGLO"|null
  foamFormat?: "ROULEAU"|"PLAQUE"|"BLOC"|null
  foamGrade?: string|null
  foamDensity?: number|null
  foamColor?: string|null
  foamFirmness?: string|null
  foamResilience?: number|null
  foamSupplierGrade?: string|null
  foamLengthCm?: number|null
  foamWidthCm?: number|null
  foamHeightCm?: number|null
  foamThicknessCm?: number|null
  description?: string|null
  foamIdentityKey?: string|null
  canonicalIdentity?:string|null
  technicalAttributesJson?:string|null
  averageCost?: string | null
  isPurchasable?:boolean
  isManufactured?:boolean
  isSellable?:boolean
  isInternalUse?:boolean
  salesUnit?:string|null
  unitsPerSale?:number
  salesUnitPrice?:number
  pendingSalesUnitPrice?:number|null
  salesPriceProposedBy?:string|null
  salesPriceProposalReason?:string|null
  salesPriceProposalRevision?:number
  stockQty: number
  minStock: number
  targetStock?:number|null
  location: string | null
  supplier: string | null
  supplierNames?: string[]
  supplierIds?: number[]
  supplierCount?: number
}

export interface ProductDTO {
  id: number
  sku: string
  name: string
  family: string
  materialId?:number|null
  unitsPerSale?:number
  model: string
  subCategory?: string | null
  commercialAbbreviation?: string | null
  commercialBrand?: string | null
  actualManufacturer?: string | null
  descriptionOverride?: string | null
  legacySku?: string | null
  legacyName?: string | null
  status?: "active" | "pending_validation" | "rejected" | "inactive"
  specialNotes?: string | null
  specialPriceStatus?: "not_required"|"pending"|"approved"|"rejected"
  specialApprovedUnitPrice?: number|null
  specialPriceProposedBy?: string|null
  specialPriceApprovedBy?: string|null
  specialPriceApprovedAt?: string|null
  specialPriceDecisionReason?: string|null
  similarProductId?: number | null
  similarProductSku?: string | null
  revisionOfId?: number | null
  revisionNumber?: number
  revisionRequestedBy?: string | null
  revisionApprovedBy?: string | null
  variant: "STD" | "L" | "U" | string
  length: number
  width: number
  height: number
  unit: string // unité de vente : "ml" | "u"
  coreType?: "SANS_RESSORTS" | "BONNELL" | "ENSACHES" | null
  foamComposition?: "PURE" | "MELANGE" | "AGGLO" | null
  mattressFinish?: "SANS" | "TOPPER" | "ALESE" | null
  upholstery?: "NUE" | "TISSU" | null
  foamNature?: "PURE" | "AGGLO" | null
  foamGrade?: string | null
  foamDensity?: number | null
  foamLayers?: string | null
  taxonomyVersion?: number
  minStock?: number
  targetStock?: number|null
  pendingCatalogUnitPrice?:number|null
  catalogPriceProposedBy?:string|null
  catalogPriceProposalReason?:string|null
  catalogPriceProposalRevision?:number
  unitPrice: number // prix de vente indicatif (saisi manuellement)
}


export interface ClientDTO {
  id: number
  name: string
  city: string
  phone: string | null
}

export interface OrderPieceDTO {
  id: number
  code: string
  salonNo: number
  elementNo: number
  partRef: string | null
  linearMeters: number | null
  gabaritCode: string | null
  billingMode: string
  sequence: number
  label: string
  shape: string
  lengthCm: number
  widthCm: number
  heightCm: number
  dimensionsExtra: string | null
  note: string | null
  status: string
}

export interface OrderLineDTO {
  kind?: "CATALOG" | "GENERIC"
  genericTemplate?:string|null
  technicalSnapshotJson?:string|null
  technicalSnapshotHash?:string|null
  productSkuSnapshot?:string|null
  productNameSnapshot?:string|null
  id: number
  productId: number
  qty: number // métrage total pour les familles linéaires ; nombre d'unités pour les matelas
  unit: string // "ml" | "u" — figée à la saisie
  unitPrice: number // prix unitaire saisi (MAD)
  catalogUnitPriceSnapshot?: number | null
  priceApprovalStatus?: "not_required" | "pending" | "approved"
  priceApprovedBy?:string|null
  priceApprovalReason?:string|null
  technicalInstructions?:string|null
  customDimensionsJson?:string|null
  technicalReviewRequired?:boolean
  modelRef?: string | null
  configRef?: string | null
  pieces?: OrderPieceDTO[]
  product: ProductDTO
}

export interface OrderDTO {
  id: number
  ref: string
  status: OrderStatus
  priority: OrderPriority
  dueDate: string | null
  createdAt: string
  note: string | null
  customerOrderNo?: string | null
  reviewComment?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  client: ClientDTO
  lines: OrderLineDTO[]
  total: number
}

export interface MovementDTO {
  id: number
  ref: string
  type: MovementType
  qty: number
  unit: string | null
  reason: string
  document: string | null
  operator: string | null
  createdAt: string
  signedQty?: number | null
  isArchived?: boolean
  isOpeningBalance?: boolean
  material: { ref: string; name: string; category: string } | null
}

export interface PurchaseLineDTO {
  id: number
  qty: number
  receivedQty: number
  consultationRemainingQty?: number
  approvedQty: number
  orderedQty?: number
  openOrderRemainingQty?: number
  draftOrderQty?: number
  approvalDecision: "pending"|"approved"|"reduced"|"rejected"
  approvalReason: string|null
  decisionBy: string|null
  decisionAt: string|null
  unitPrice: number | null
  material: MaterialDTO
}

export interface PurchaseDTO {
  id: number
  ref: string
  status: PurchaseStatus
  supplier: string | null
  expectedDate: string | null
  note: string | null
  createdAt: string
  lines: PurchaseLineDTO[]
  approvalHistory?: {id:number;actor:string;action:string;entity:string;entityId:string;details:string|null;createdAt:string}[]
  receipts?: {id:number;deliveryRef:string;operator:string;createdAt:string;note:string|null;lines:{requestLineId:number;acceptedQty:number;rejectedQty:number;lot:string|null}[]}[]
  closedReason?: string | null
  closedBy?: string | null
  total: number | null
}

// —— Réponse de /api/orders ——

export interface DashboardDTO {
  baseline?: {unverifiedLots:number;unverifiedMovements:number;archivedLegacyMovements?:number;demoOpeningMovements?:number;stockValueIsProvisional:boolean}
  kpi: {
    /** Null pour les rôles sans visibilité sur les coûts matières. */
    stockValue: number | null
    stockUnits: number
    alerts: number
    activeOrders: number
    /** V18.9.1 (contre-audit A-03) : null pour les rôles non commerciaux. */
    pipelineValue: number | null
    lateOrders: number
    products: number
    openPurchases: number // demandes d'achat non réceptionnées
  }
  byCategory: { category: string; value: number }[]
  flow: { day: string; in: number; out: number }[]
  flowUnit: string
  recentMovements: MovementDTO[]
  alertsList: MaterialDTO[]
  upcoming: DashboardUpcomingDTO[]
}

/** V18.9.1 (contre-audit A-03) : commandes à venir du tableau de bord.
 * Les données clients et montants sont null pour les rôles hors
 * commercial / finances / admin (fiches clients réservées). */
export interface DashboardUpcomingDTO {
  id: number
  ref: string
  status: OrderStatus
  priority: OrderPriority
  dueDate: string | null
  createdAt: string
  note: string | null
  client: ClientDTO | null
  total: number | null
}

// ─────────────────────────────────────────────
// Helpers de formatage (client)
// ─────────────────────────────────────────────
// V18.9.10 (UX-015) : formatage monétaire unique. `cents: true` conserve
// les centimes pour les documents financiers (factures, avoirs, règlements) ;
// le comportement par défaut (arrondi à l'unité) est inchangé pour les vues
// opérationnelles.
export function fmtMAD(v: number | null | undefined, opts?: { cents?: boolean }): string {
  if (v == null || Number.isNaN(v)) return "—"
  if (opts?.cents) {
    return (
      v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u202f|\u00a0/g, " ") +
      " MAD"
    )
  }
  const n = Math.round(v)
  return n.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ") + " MAD"
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—"
  const abs = Math.abs(v)
  const d = abs >= 1000 ? 0 : digits
  return v.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: 0 })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "à l'instant"
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `il y a ${h} h`
  const j = Math.floor(h / 24)
  if (j < 30) return `il y a ${j} j`
  return fmtDate(iso)
}

export function stockLevel(m: MaterialDTO): "out" | "low" | "ok" {
  if (m.stockQty <= 0) return "out"
  if (m.stockQty < m.minStock) return "low"
  return "ok"
}

// ─────────────────────────────────────────────
// Unités de vente produits
// ─────────────────────────────────────────────
export function unitLabel(unit: string): string {
  if (unit === "ml") return "ml"
  if (unit === "u") return "unité"
  return unit
}

export function unitShort(unit: string): string {
  return unit === "u" ? "u" : unit
}

// Formate une quantité dans son unité de vente : "6,5 ml", "2 unités"
export function fmtQty(qty: number | null | undefined, unit: string): string {
  if (qty == null || Number.isNaN(qty)) return "—"
  const n = fmtNum(qty, 2)
  if (unit === "u") return `${n} ${qty > 1 ? "unités" : "unité"}`
  return `${n} ${unitShort(unit)}`
}
