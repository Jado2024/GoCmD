"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import { toast } from "sonner"

import type {
  ClientDTO,
  DashboardDTO,
  MaterialDTO,
  MovementDTO,
  OrderDTO,
  ProductDTO,
  PurchaseDTO,
} from "@/lib/erp-types"

// ─────────────────────────────────────────────
// Fetch helper
// ─────────────────────────────────────────────
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    // V18.9.13-p3 : les comptes SQLite utilisent une session révocable.
    // Une réponse 401 doit expliquer la reconnexion via la vraie page /login.
    // Les contrôles de session et de rôle restent appliqués côté serveur.
    const body = await res.json().catch(() => ({}))
    const message =
      res.status === 401
        ? "Session expirée : reconnectez-vous depuis la page de connexion."
        : body.error ?? `Erreur ${res.status}`
    throw Object.assign(new Error(message), { body, status: res.status })
  }
  return res.json() as Promise<T>
}

// ─────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────
export function useDashboard(enabled=true): UseQueryResult<DashboardDTO> {
  return useQuery({
    queryKey: ["dashboard"],
    enabled,
    queryFn: () => api<DashboardDTO>("/api/dashboard"),
    staleTime: 15_000,
  })
}

export function useMaterials(params: { q?: string; category?: string; status?: string; page?: number; pageSize?: number; sort?: "ref"|"name"|"stock"|"category"; supplier?: string; sharedSupplierIds?: number[]; purchasableOnly?: boolean; da?: "all"|"without"|"active"|"history" }) {
  const qs = new URLSearchParams()
  if (params.q) qs.set("q", params.q)
  if (params.category) qs.set("category", params.category)
  if (params.status && params.status !== "all") qs.set("status", params.status)
  if(params.page)qs.set("page",String(params.page))
  if(params.pageSize)qs.set("pageSize",String(params.pageSize))
  if(params.sort)qs.set("sort",params.sort)
  if(params.supplier)qs.set("supplier",params.supplier)
  if(params.purchasableOnly)qs.set("purchasableOnly","1")
  if(params.da && params.da!=="all")qs.set("da",params.da)
  if(params.sharedSupplierIds?.length)qs.set("sharedSupplierIds",params.sharedSupplierIds.join(","))
  return useQuery({
    queryKey: ["materials", params.q ?? "", params.category ?? "", params.status ?? "all",params.page??1,params.pageSize??200,params.sort??"ref",params.supplier??"",params.sharedSupplierIds?.join(",")??"",params.purchasableOnly??false,params.da??"all"],
    queryFn: () => api<{ items: MaterialDTO[]; total: number; categories: string[]; page:number;pages:number;pageSize:number }>(`/api/materials?${qs}`),
    staleTime: 10_000,
  })
}

export function useProducts(params: {
  q?: string
  family?: string
  model?: string
  variant?: string
  subCategory?: string
  coreType?: string
  foamComposition?: string
  foamNature?: string
  page?: number
}) {
  const qs = new URLSearchParams()
  if (params.q) qs.set("q", params.q)
  if (params.family) qs.set("family", params.family)
  if (params.model) qs.set("model", params.model)
  if (params.variant) qs.set("variant", params.variant)
  if (params.subCategory) qs.set("subCategory", params.subCategory)
  if (params.coreType) qs.set("coreType", params.coreType)
  if (params.foamComposition) qs.set("foamComposition", params.foamComposition)
  if (params.foamNature) qs.set("foamNature", params.foamNature)
  if (params.page) qs.set("page", String(params.page))
  return useQuery({
    queryKey: ["products", params.q ?? "", params.family ?? "", params.model ?? "", params.variant ?? "", params.subCategory ?? "", params.coreType??"",params.foamComposition??"",params.foamNature??"", params.page ?? 1],
    queryFn: () =>
      api<{ items: ProductDTO[]; total: number; page: number; pages: number }>(`/api/products?${qs}`),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

export function useProductFacets() {
  return useQuery({
    queryKey: ["product-facets"],
    queryFn: () =>
      api<{ families: { family: string; models: string[]; variants: string[]; subCategories: string[]; coreTypes:string[]; foamCompositions:string[]; foamNatures:string[] }[] }>("/api/products?facets=1"),
    staleTime: 5 * 60_000,
  })
}

export function useClients(q="",page=1,pageSize=50) {
  const params=new URLSearchParams({q,take:String(pageSize),skip:String((page-1)*pageSize)})
  return useQuery({
    queryKey: ["clients",q,page,pageSize],
    queryFn: () => api<{items:ClientDTO[];pagination:{total:number;take:number;skip:number;pages:number}}>(`/api/clients?${params}`),
    staleTime: 10 * 60_000,
  })
}

export interface CreateClientInput {
  name: string
  city: string
  phone?: string | null
}

export function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateClientInput) =>
      api<{ client: ClientDTO }>("/api/clients", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["clients"] })
      toast.success(`Client « ${res.client.name} » enregistré`, {
        description: `${res.client.city}${res.client.phone ? ` · ${res.client.phone}` : ""}`,
      })
    },
    onError: (e: Error) => toast.error(e.message || "Échec de création du client"),
  })
}

// R11 : projection volontairement minimale pour les cartes. Le détail complet
// n'est récupéré qu'après sélection, dans /api/orders/[id].
export type OrderListItem = Pick<OrderDTO,"id"|"ref"|"status"|"priority"|"dueDate"|"createdAt"|"total"> & {
  client:Pick<ClientDTO,"id"|"name"|"city">;
  lineCount:number;
}

export function useOrders(page=1,q="",pageSize=50) {
  const qs=new URLSearchParams({skip:String((page-1)*pageSize),take:String(pageSize),q})
  return useQuery({
    queryKey: ["orders",page,q,pageSize],
    queryFn: () => api<{ items: OrderListItem[];pagination:{total:number;skip:number;take:number;hasMore:boolean};summary:{total:number;late:number;portfolio:number} }>(`/api/orders?${qs}&view=list`),
    staleTime: 10_000,
  })
}

export function usePurchases(page = 1, status = 'all', q = '', pageSize = 100) {
  const qs=new URLSearchParams({page:String(page),pageSize:String(pageSize),status,q})
  return useQuery({
    queryKey: ["purchases",page,status,q,pageSize],
    queryFn: () => api<{ items: PurchaseDTO[];pagination:{page:number;pageSize:number;total:number;hasMore:boolean};statusCounts:Record<string,number> }>(`/api/purchases?${qs}`),
    staleTime: 10_000,
  })
}

export function useMovements(params: { type?: string; q?: string; archive?: boolean }) {
  const qs = new URLSearchParams()
  if (params.type && params.type !== "all") qs.set("type", params.type)
  if (params.q) qs.set("q", params.q)
  if (params.archive) qs.set("archive", "legacy")
  return useQuery({
    queryKey: ["movements", params.type ?? "all", params.q ?? "", params.archive ?? false],
    queryFn: () => api<{ items: MovementDTO[] }>(`/api/movements?${qs}`),
    placeholderData: (prev) => prev,
    staleTime: 5_000,
  })
}

// ─────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────

export interface CommandPartInput {
  label: string
  partRef?: string
  count: number
  shape: "rectangle" | "L" | "U" | "trapeze" | "angle_coupe" | "arrondi" | "gabarit"
  lengthCm: number
  widthCm: number
  heightCm: number
  linearMeters?: number
  gabaritCode?: string
  billingMode?: "manual" | "computed"
  extra?: Record<string, number>
  note?: string
}
export interface CreateOrderInput {
  clientId: number
  dueDate: string
  priority: "normale" | "haute"
  note?: string | null
  customerOrderNo?: string | null
  lines: {
    productId: number; qty: number; unitPrice: number
    generic?: {template:"GEN-MAT"|"GEN-MOU"|"GEN-SAL"|"GEN-DIV";description:string;specifications:string;
      lengthCm?:number;widthCm?:number;heightCm?:number;requiresPreparation:boolean}
    modelRef?: string; configRef?: string
    technicalInstructions?: string
    dimensions?: {lengthCm:number;widthCm:number;heightCm:number}
    pieceCount?: number
    ensembleCount?: number // nombre de salons identiques, distinct du métrage
    parts?: CommandPartInput[]
  }[]
}

export function useCreateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateOrderInput & { requestKey?: string; duplicateReview?: {token:string;reason:string} }) => {
      const {requestKey, ...payload} = input
      return api<{ order: OrderDTO }>("/api/orders", {method:"POST",body:JSON.stringify(payload),
        headers:requestKey?{"Idempotency-Key":requestKey}:undefined})
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["orders"] })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
      toast.success(`Commande ${res.order.ref} enregistrée`, {
        description: `${res.order.lines.length} ligne${res.order.lines.length > 1 ? "s" : ""} · ${Math.round(res.order.total).toLocaleString("fr-FR")} MAD`,
      })
    },
    onError: (e: Error) => toast.error(e.message || "Échec de création"),
  })
}

export function useAdvanceOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      api<{ order: OrderDTO }>(`/api/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "advance" }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["orders"] })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
      toast.success(`Commande ${res.order.ref} → ${labelForStatus(res.order.status)}`)
    },
    onError: (e) => toast.error((e as Error).message || "Échec"),
  })
}

function labelForStatus(s: string) {
  return (
    {
      new: "nouvelle",
      production: "en production",
      ready: "prête",
      shipped: "expédiée",
      pending_validation: "en attente de validation",
      rejected: "refusée",
    } as Record<string, string>
  )[s] ?? s
}

export interface UpdateProductInput {
  id: number
  reason: string
  unitPrice?: number
  minStock?:number
  targetStock?:number|null
  unit?: "ml" | "u" | "kg"
  commercialAbbreviation?:string
  commercialBrand?:string
  actualManufacturer?:string
  descriptionOverride?:string
}

export function useUpdateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProductInput) =>
      api<ProductDTO>(`/api/products/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ unitPrice: input.unitPrice, minStock:input.minStock,targetStock:input.targetStock, unit: input.unit, reason: input.reason, commercialAbbreviation:input.commercialAbbreviation, commercialBrand:input.commercialBrand, actualManufacturer:input.actualManufacturer, descriptionOverride:input.descriptionOverride }),
      }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["products"] })
      qc.invalidateQueries({ queryKey: ["product", p.id] })
      toast.success(`Fiche ${p.name} mise à jour`)
    },
    onError: (e) => toast.error((e as Error).message || "Échec de mise à jour"),
  })
}

export interface CreatePurchaseInput {
  supplier?: string | null
  expectedDate?: string | null
  note?: string | null
  duplicateJustification?: string
  lines: { materialId: number; qty: number }[]
}

export function useCreatePurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePurchaseInput) =>
      api<{ purchase: PurchaseDTO }>("/api/purchases", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["purchases"] })
      qc.invalidateQueries({queryKey:["buyer-workbench"]})
      qc.invalidateQueries({ queryKey: ["material-da-followup"] })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
      toast.success(`Demande d'achat ${res.purchase.ref} créée`)
    },
    onError: (e: Error) => toast.error(e.message || "Échec de création"),
  })
}

export function useAdvancePurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, operator, decisions }: { id: number; operator?: string; decisions?: {lineId:number;decision:"approve"|"reduce"|"reject";approvedQty?:number;reason?:string}[] }) =>
      api<{ purchase: PurchaseDTO; received: { ref: string }[] | null }>(`/api/purchases/${id}`, {
        method: "PATCH",
        body: JSON.stringify(decisions?{ action: "decide-lines", decisions }:{ action: "advance", operator }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["purchases"] })
      qc.invalidateQueries({queryKey:["buyer-workbench"]})
      qc.invalidateQueries({ queryKey: ["material-da-followup"] })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
      qc.invalidateQueries({ queryKey: ["materials"] })
      qc.invalidateQueries({ queryKey: ["movements"] })
      const label =
        {
          approved: "validée",
          partially_approved:"partiellement approuvée",
          rejected:"refusée",
          ordered: "commandée",
          received: "réceptionnée (entrée en stock)",
          closed: "clôturée",
        } as Record<string, string>
      toast.success(`Demande ${res.purchase.ref} ${label[res.purchase.status] ?? res.purchase.status}`)
    },
    onError: (e: Error) => toast.error(e.message || "Échec"),
  })
}

export function useClosePurchase() {
  const qc=useQueryClient()
  return useMutation({
    mutationFn:({id,reason}:{id:number;operator?:string;reason:string})=>
      api<{purchase:PurchaseDTO}>(`/api/purchases/${id}`,{method:"PATCH",body:JSON.stringify({action:"close",reason})}),
    onSuccess:res=>{
      qc.invalidateQueries({queryKey:["purchases"]});qc.invalidateQueries({queryKey:["buyer-workbench"]});qc.invalidateQueries({queryKey:["material-da-followup"]});qc.invalidateQueries({queryKey:["dashboard"]})
      toast.success(`DA ${res.purchase.ref} clôturée avec motif`)
    },
    onError:(e:Error)=>toast.error(e.message||"Clôture impossible")
  })
}
export function useCancelPurchase() {
  const qc=useQueryClient()
  return useMutation({
    mutationFn:({id,reason}:{id:number;reason:string})=>
      api<{purchase:PurchaseDTO}>(`/api/purchases/${id}`,{method:"PATCH",body:JSON.stringify({action:"cancel",reason})}),
    onSuccess:res=>{
      qc.invalidateQueries({queryKey:["purchases"]});qc.invalidateQueries({queryKey:["buyer-workbench"]});qc.invalidateQueries({queryKey:["material-da-followup"]});qc.invalidateQueries({queryKey:["dashboard"]});qc.invalidateQueries({queryKey:["materials"]})
      toast.success(`DA ${res.purchase.ref} annulée : le réapprovisionnement redevient possible`)
    },
    onError:(e:Error)=>toast.error(e.message||"Annulation impossible")
  })
}

export interface ManualMovementInput {
  type: "out"
  materialId: number
  qty: number
  reason: string
  stockLotId: number
}

export function useManualMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ManualMovementInput) =>
      api<{ ref: string; stock: number }>("/api/movements", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["materials"] })
      qc.invalidateQueries({ queryKey: ["movements"] })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
      toast.success(`Mouvement ${res.ref} enregistré`, { description: `Nouveau stock : ${res.stock}` })
    },
    onError: (e: Error) => toast.error(e.message || "Échec"),
  })
}

export interface CreateProductInput {
  model:string; family:"BANQUETTE"|"SALON"|"GAUFRETTE"|"MATELAS"|"PLAQUE_MOUSSE"|"OUATE";
  coreType?:"SANS_RESSORTS"|"BONNELL"|"ENSACHES";
  foamComposition?:"PURE"|"MELANGE"|"AGGLO";
  mattressFinish?:"SANS"|"TOPPER"|"ALESE";
  upholstery?:"NUE"|"TISSU";
  foamNature?:"PURE"|"AGGLO";
  foamGrade?:string; foamDensity?:number; foamLayers?:string;
  length:number; width:number; height:number; unitPrice:number; subCategory:string;
  similarProductId?:number; specialNotes:string
  commercialAbbreviation?:string;commercialBrand?:string;actualManufacturer?:string;descriptionOverride?:string
}
export function useCreateProduct() {
  const qc=useQueryClient()
  return useMutation({
    mutationFn:(input:CreateProductInput)=>api<{product:ProductDTO}>("/api/products",{method:"POST",body:JSON.stringify(input)}),
    onSuccess:({product})=>{
      qc.invalidateQueries({queryKey:["products"]}); qc.invalidateQueries({queryKey:["product-facets"]});
      toast.success(`Référence provisoire ${product.sku} créée`,{description:"Le prix proposé doit être approuvé par un directeur avant validation de la commande ou émission du devis."})
    },
    onError:(e:Error)=>toast.error(e.message||"Échec de création du produit")
  })
}

// Approbation / refus avec session nominative et séparation des tâches (sans clé partagée).
export function useReviewOrder(){
  const qc=useQueryClient()
  return useMutation({
    mutationFn:({id,action,comment}:{id:number;action:"approve"|"reject";comment:string})=>
      api<{order:OrderDTO}>(`/api/orders/${id}`,{method:"PATCH",body:JSON.stringify({action,comment})}),
    onSuccess:({order})=>{
      qc.invalidateQueries({queryKey:["orders"]}); qc.invalidateQueries({queryKey:["dashboard"]});
      qc.invalidateQueries({queryKey:["products"]}); qc.invalidateQueries({queryKey:["product-facets"]});
      toast.success(`Commande ${order.ref} ${order.status==="new"?"validée":"refusée"}`)
    },
    onError:(e:Error)=>toast.error(e.message||"Échec de validation"),
  })
}
