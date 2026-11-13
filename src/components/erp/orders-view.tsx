"use client";

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "./hooks"
import { hasRole, type SessionActor } from "@/lib/role-navigation"
import { ChevronRight, Factory, Plus, Truck, Warehouse, ShieldCheck } from "lucide-react"
import { WorkOrdersPanel } from "./work-orders-panel"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { fmtMAD, fmtDate, fmtQty, type OrderDTO, type OrderStatus } from "@/lib/erp-types"
import { OrderStatusBadge, PriorityBadge, VariantTag } from "./bits"
import { ListSearch } from "./list-controls"
import { useAdvanceOrder, useOrders, useReviewOrder, type OrderListItem } from "./hooks"

const COLUMNS: { id: OrderStatus; label: string; hint: string }[] = [
  { id: "pending_validation", label: "À valider", hint: "Approbation du responsable avant OF et livraison" },
  { id: "rejected", label: "Refusées", hint: "Demande refusée, aucune production" },
  { id: "new", label: "Nouvelles", hint: "À lancer en production" },
  { id: "production", label: "En production", hint: "En cours de fabrication atelier" },
  { id: "ready", label: "Prêtes", hint: "Prêtes à expédier" },
  { id: "shipped", label: "Expédiées", hint: "Livraisons terminées" },
]

const NEXT_LABEL: Record<string, string> = {
  new: "Lancer la production",
  production: "Marquer prête",
  ready: "Marquer expédiée",
}

export function OrdersView({ onNewOrder }: { onNewOrder: (presetProductId?: number) => void }) {
  const [orderPage,setOrderPage]=useState(1)
  const [orderSearch,setOrderSearch]=useState("")
  const [pricePage,setPricePage]=useState(1)
  const { data, isPending, isFetching:ordersFetching, isError:ordersError } = useOrders(orderPage,orderSearch,50)
  const orders = data?.items ?? []
  const advance = useAdvanceOrder()
  const review = useReviewOrder()
  const [detail, setDetail] = useState<OrderDTO | null>(null)
  const [loadingDetailId,setLoadingDetailId] = useState<number | null>(null)
  const [fulfillmentReason,setFulfillmentReason]=useState("")
  const [fulfillmentBusy,setFulfillmentBusy]=useState(false)
  // R6 : la recherche utilise la totalité de la BDD via l'API paginée.
  const [reviewComment,setReviewComment]=useState("")
  const [priceValues,setPriceValues]=useState<Record<number,string>>({})
  const [priceReason,setPriceReason]=useState("")
  const [directorPassword,setDirectorPassword]=useState("")
  const [orderPriceReason,setOrderPriceReason]=useState("")
  const [pricingBusy,setPricingBusy]=useState(false)
  const session=useQuery({queryKey:["me"],queryFn:()=>api<SessionActor>("/api/me"),staleTime:60000})
  const qc=useQueryClient()
  // C4-R2 : alignement UX sur le contrôle serveur de director.prices.
  // Le serveur reste l'autorité finale ; ce garde n'est qu'une protection UX.
  const canDecidePrices=Boolean(session.data?.roles.includes("director") && !session.data?.isRoot && session.data?.permissions?.["director.prices"] !== false)
  const canReview=hasRole(session.data,"approver")
  const canSell=hasRole(session.data,"sales")
  const priceQueue=useQuery({queryKey:["director-prices",pricePage],
    queryFn:()=>api<{items:import("@/lib/erp-types").ProductDTO[];total:number;page:number;pages:number}>(`/api/products?pendingPrice=1&page=${pricePage}&pageSize=25`),
    enabled:canDecidePrices,staleTime:0})
  useEffect(()=>{if(priceQueue.data && pricePage>priceQueue.data.pages)setPricePage(priceQueue.data.pages)},[pricePage,priceQueue.data])
  useEffect(()=>{if(data && orderPage>Math.max(1,Math.ceil(data.pagination.total/50)))setOrderPage(Math.max(1,Math.ceil(data.pagination.total/50)))},[orderPage,data])
  const [queueReason,setQueueReason]=useState("")
  const [queuePrices,setQueuePrices]=useState<Record<number,string>>({})
  async function decideOrderPrice(orderId:number,lineId:number,action:"approve-prices"|"reject-prices"){
    if(orderPriceReason.trim().length<8){toast.error("Motif de 8 caractères minimum");return}
    if(action==="approve-prices"&&!directorPassword){toast.error("Confirmer avec votre mot de passe personnel");return}
    setPricingBusy(true)
    try{
      const decision=await api<{order:OrderDTO}>(`/api/orders/${orderId}`,{method:"PATCH",body:JSON.stringify({action,lineId,reason:orderPriceReason.trim(),...(action==="approve-prices"?{sensitivePassword:directorPassword}:{})})})
      toast.success(action==="approve-prices"?"Prix de la ligne validé":"Ligne refusée : commande rejetée")
      setOrderPriceReason("");setDetail(decision.order)
      await Promise.all([qc.invalidateQueries({queryKey:["orders"]}),qc.invalidateQueries({queryKey:["work-orders"]})])
    }catch(e){toast.error(e instanceof Error?e.message:"Décision refusée")}
    finally{setPricingBusy(false);setDirectorPassword("")}
  }
  async function decideQueuedPrice(product:import("@/lib/erp-types").ProductDTO,action:"approve"|"reject"){
    const price=Number(queuePrices[product.id]??String(product.unitPrice))
    if(queueReason.trim().length<8 || (action==="approve" && (!Number.isFinite(price)||price<=0))){toast.error("Saisir un prix positif et un motif de 8 caractères minimum");return}
    if(action==="approve"&&!directorPassword){toast.error("Confirmer avec votre mot de passe personnel");return}
    setPricingBusy(true)
    try{
      await api(`/api/products/${product.id}/director-price`,{method:"POST",body:JSON.stringify({action,reason:queueReason.trim(),...(action==="approve"?{unitPrice:price,sensitivePassword:directorPassword}:{})})})
      toast.success(action==="approve"?"Prix spécial approuvé":"Prix spécial refusé")
      setQueueReason("");setQueuePrices({});setDetail(null)
      await Promise.all([qc.invalidateQueries({queryKey:["director-prices"]}),qc.invalidateQueries({queryKey:["orders"]}),qc.invalidateQueries({queryKey:["products"]})])
    }catch(e){toast.error(e instanceof Error?e.message:"Décision impossible")}
    finally{setPricingBusy(false);setDirectorPassword("")}
  }
  async function proposePrice(productId:number,current:number){
    const unitPrice=Number(priceValues[productId]??String(current))
    if(!Number.isFinite(unitPrice)||unitPrice<=0||priceReason.trim().length<8){toast.error("Prix positif et motif obligatoire (8 caractères)");return}
    setPricingBusy(true)
    try{
      await api(`/api/products/${productId}/director-price`,{method:"POST",body:JSON.stringify({action:"propose",unitPrice,reason:priceReason.trim()})})
      toast.success("Nouvelle proposition envoyée au directeur. Ancienne approbation annulée.")
      setDetail(null);setPriceValues({});setPriceReason("")
      await Promise.all([qc.invalidateQueries({queryKey:["orders"]}),qc.invalidateQueries({queryKey:["director-prices"]})])
    }catch(e){toast.error(e instanceof Error?e.message:"Nouvelle proposition impossible")}
    finally{setPricingBusy(false);setDirectorPassword("")}
  }
  async function decidePrice(productId:number,action:"approve"|"reject",proposed:number){
    if(!detail || priceReason.trim().length<8)return
    const unitPrice=Number(priceValues[productId]??String(proposed))
    if(action==="approve" && (!Number.isFinite(unitPrice)||unitPrice<=0)){
      toast.error("Saisir un tarif positif");return
    }
    if(action==="approve"&&!directorPassword){toast.error("Confirmer avec votre mot de passe personnel");return}
    setPricingBusy(true)
    try{
      await api(`/api/products/${productId}/director-price`,{method:"POST",body:JSON.stringify({action,reason:priceReason.trim(),...(action==="approve"?{unitPrice,sensitivePassword:directorPassword}:{})})})
      toast.success(action==="approve"?"Prix approuvé par le directeur":"Prix refusé : nouvelle proposition nécessaire")
      setDetail(null);setPriceReason("");setPriceValues({})
      await Promise.all([qc.invalidateQueries({queryKey:["orders"]}),qc.invalidateQueries({queryKey:["products"]}),qc.invalidateQueries({queryKey:["dashboard"]}),qc.invalidateQueries({queryKey:["director-prices"]})])
    }catch(e){toast.error(e instanceof Error?e.message:"Décision impossible")}
    finally{setPricingBusy(false);setDirectorPassword("")}
  }

  const byStatus = useMemo(() => {
    const map = new Map<string, OrderListItem[]>()
    for (const o of orders) {
      if (!map.has(o.status)) map.set(o.status, [])
      map.get(o.status)!.push(o)
    }
    return map
  }, [orders])

  const pipeline=data?.summary.portfolio??0
  const late=data?.summary.late??0

  async function changeFulfillment(o:OrderDTO,action:"hold"|"resume"|"close"){
    if(fulfillmentReason.trim().length<10){toast.error("Motif obligatoire : au moins 10 caractères");return}
    setFulfillmentBusy(true)
    try{
      const res=await api<{order:OrderDTO}>(`/api/orders/${o.id}`,{method:"PATCH",body:JSON.stringify({action,reason:fulfillmentReason.trim()})})
      setDetail(res.order);setFulfillmentReason("")
      toast.success(action==="hold"?"Commande suspendue et réservations libérées":action==="close"?"Reliquat clôturé et réservations libérées":"Commande reprise")
      await Promise.all([qc.invalidateQueries({queryKey:["orders"]}),qc.invalidateQueries({queryKey:["sales-orders"]}),qc.invalidateQueries({queryKey:["sales-availability"]})])
    }catch(e){toast.error(e instanceof Error?e.message:"Transition refusée")}
    finally{setFulfillmentBusy(false)}
  }
  function handleAdvance(o: OrderDTO) {
    advance.mutate(
      { id: o.id },
      {
        onSuccess: (res) => {
          setDetail(res.order.status === "shipped" ? null : res.order)
        },
      },
    )
  }

  // R11 : charger les lignes et pièces seulement à l'ouverture du détail.
  async function openOrderDetail(id:number){
    setLoadingDetailId(id)
    try{
      const result=await api<{order:OrderDTO}>(`/api/orders/${id}`)
      setDetail(result.order)
      setReviewComment("")
    }catch(e){toast.error(e instanceof Error?e.message:"Impossible de charger la commande")}
    finally{setLoadingDetailId(null)}
  }

  function handleReview(o:OrderDTO,action:"approve"|"reject"){
    // Le responsable enregistré est le compte authentifié (serveur) :
    // aucun nom libre n'est saisi, impossible d'usurper la décision.
    review.mutate({id:o.id,action,comment:reviewComment},{onSuccess:({order})=>{
      setDetail(order);setReviewComment("")
    }})
  }

  return (
    <div className="space-y-4">
      {canDecidePrices && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
        <h2 className="font-semibold text-amber-950">Prix spéciaux à valider par le directeur ({priceQueue.data?.total??0})</h2>
        <p className="text-xs text-amber-900">Cette liste inclut les références sans commande : le tarif doit être approuvé avant l'émission d'un devis. L'approbation de commande demeure séparée.</p>
        <label className="block text-xs font-semibold">Confirmer une autorisation tarifaire avec votre mot de passe personnel
          <Input type="password" autoComplete="current-password" className="mt-1 max-w-xs" value={directorPassword} onChange={e=>setDirectorPassword(e.target.value)}/>
        </label>
        {(priceQueue.data?.items??[]).map(p=><div key={p.id} className="rounded-lg border bg-white p-3 space-y-2">
          <p className="text-sm font-medium">{p.name} · {p.sku}</p>
          <p className="text-xs">Proposé par {p.specialPriceProposedBy??"compte non identifié"} : {fmtMAD(p.unitPrice)}/{p.unit}. {p.specialNotes}</p>
          <label className="block text-xs font-semibold">Prix autorisé (MAD/{p.unit})<Input type="number" min="0.01" step="0.01" className="mt-1" value={queuePrices[p.id]??String(p.unitPrice)} onChange={e=>setQueuePrices(old=>({...old,[p.id]:e.target.value}))}/></label>
          <label className="block text-xs font-semibold">Motif (8 caractères minimum)<Textarea className="mt-1" maxLength={500} value={queueReason} onChange={e=>setQueueReason(e.target.value)}/></label>
          <div className="flex gap-2"><Button disabled={pricingBusy||!directorPassword||queueReason.trim().length<8} onClick={()=>void decideQueuedPrice(p,"approve")}>Approuver le tarif</Button><Button variant="destructive" disabled={pricingBusy||queueReason.trim().length<8} onClick={()=>void decideQueuedPrice(p,"reject")}>Refuser</Button></div>
        </div>)}
        {priceQueue.isError && <p role="alert" className="text-sm text-rose-800">Impossible de charger les prix en attente. Réessayez.</p>}
        {priceQueue.isFetching && <p role="status" className="text-xs text-amber-900">Actualisation des prix spéciaux…</p>}
        {!priceQueue.isFetching && !priceQueue.isError && !priceQueue.data?.items.length && <p className="text-sm text-amber-900">Aucune proposition sur cette page.</p>}
        {(priceQueue.data?.total??0)>25 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 pt-3" aria-label="Pagination des prix spéciaux">
          <span className="text-xs text-amber-950">Page {pricePage} sur {priceQueue.data?.pages??1} · {priceQueue.data?.total??0} propositions</span>
          <div className="flex gap-2"><Button variant="outline" size="sm" disabled={pricePage<=1||priceQueue.isFetching} onClick={()=>setPricePage(p=>Math.max(1,p-1))}>Précédente</Button>
          <Button variant="outline" size="sm" disabled={pricePage>=(priceQueue.data?.pages??1)||priceQueue.isFetching} onClick={()=>setPricePage(p=>p+1)}>Suivante</Button></div>
        </div>}
      </section>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Portefeuille</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{fmtMAD(pipeline)}</p>
            <p className="text-[11px] text-slate-500">{data?.summary.total??0} commandes au total</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">En retard</p>
            <p className={`mt-1 text-lg font-bold ${late > 0 ? "text-rose-700" : "text-slate-900"}`}>
              {late}
            </p>
            <p className="text-[11px] text-slate-500">échéances dépassées (hors expédiées)</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          {/* V18.9.9 (UX-01) : flex-wrap — le bouton passe à la ligne sur les
              largeurs étroites (768 px) au lieu de déborder du viewport. */}
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Saisie</p>
              <p className="mt-1 text-sm text-slate-600">Nouvelle commande à produire</p>
            </div>
            {canSell && <Button variant="primary" className="gap-1.5" onClick={() => onNewOrder()}>
              <Plus className="size-4" /> Nouvelle commande
            </Button>}
          </CardContent>
        </Card>
      </div>

      {/* R6 : filtre serveur sur l'ensemble des références et clients, jamais une recherche sur 100 éléments. */}
      <ListSearch
        value={orderSearch}
        onChange={value=>{setOrderSearch(value);setOrderPage(1)}}
        placeholder="Rechercher une commande (réf., client)…"
        shown={orders.length}
        total={data?.pagination.total??0}
        unit="commandes"
        global
      />
      {ordersError && <p role="alert" className="rounded-md border border-rose-300 p-3 text-sm text-rose-800">Impossible de charger les commandes. Réessayez.</p>}
      <nav aria-label="Pagination des commandes" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-2">
        <span className="text-xs text-slate-700">Page {orderPage} sur {Math.max(1,Math.ceil((data?.pagination.total??0)/50))} · {data?.pagination.total??0} commande(s) correspondant à la recherche</span>
        <div className="flex gap-2"><Button variant="outline" size="sm" disabled={orderPage<=1||ordersFetching} onClick={()=>setOrderPage(p=>Math.max(1,p-1))}>Précédente</Button>
        <Button variant="outline" size="sm" disabled={!data?.pagination.hasMore||ordersFetching} onClick={()=>setOrderPage(p=>p+1)}>Suivante</Button></div>
      </nav>

      {/* Kanban — V18.9.10 (UX-037) : skeleton aligné sur la grille réelle
          (lg:2 / xl:3) pour supprimer le saut de layout au chargement. */}
      {isPending ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {COLUMNS.map((c) => (
            <Skeleton key={c.id} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {COLUMNS.map((col) => {
            const list = byStatus.get(col.id) ?? []
            return (
              <Card key={col.id} className="flex flex-col border-slate-200">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-sm font-semibold">
                    {col.label}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {list.length}
                    </span>
                  </CardTitle>
                  <CardDescription className="text-xs">{col.hint}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 space-y-2.5 pt-0">
                  {list.length === 0 && (
                    <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                      Aucune commande
                    </p>
                  )}
                  {list.map((o) => {
                    const isLate = o.dueDate && new Date(o.dueDate) < new Date() && ["new","production","ready"].includes(o.status)
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => void openOrderDetail(o.id)}
                        disabled={loadingDetailId === o.id}
                        className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition-shadow hover:shadow-md"
                      >
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold text-slate-800">{o.ref}</span>
                          <PriorityBadge priority={o.priority} />
                          {isLate && (
                            <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                              Retard
                            </span>
                          )}
                        </p>
                        <p className="mt-1 truncate text-xs text-slate-500">{o.client.name}</p>
                        <p className="mt-1 flex items-center justify-between">
                          <span className="text-xs text-slate-500">
                            {fmtDate(o.dueDate)} · {o.lineCount} article{o.lineCount > 1 ? "s" : ""}
                          </span>
                          <span className="text-sm font-bold text-slate-900">{fmtMAD(o.total)}</span>
                        </p>
                      </button>
                    )
                  })}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Détail commande */}
      <Dialog open={detail != null} onOpenChange={(o) => {if(!o){setDetail(null);setDirectorPassword("")}}}>
        <DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {detail.ref}
                  <OrderStatusBadge status={detail.status} />
                  <PriorityBadge priority={detail.priority} />
                </DialogTitle>
                <DialogDescription>
                  {detail.client.name} · {detail.client.city} — livraison souhaitée le{" "}
                  {fmtDate(detail.dueDate)}
                  {detail.dueDate && new Date(detail.dueDate) < new Date() && detail.status !== "shipped" && (
                    <span className="ml-1 font-semibold text-rose-600">(en retard)</span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produit</TableHead>
                      <TableHead>Var.</TableHead>
                      <TableHead className="text-right">Quantité</TableHead>
                      <TableHead className="text-right">Prix unitaire</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="max-w-64"><p className="truncate">{l.productNameSnapshot??l.product.name}</p>{l.technicalInstructions&&<p className="whitespace-pre-wrap text-xs font-semibold text-amber-800">{l.technicalInstructions}</p>}{l.customDimensionsJson&&<p className="text-xs text-slate-600">Dimensions spécifiques : {(()=>{try{const d=JSON.parse(l.customDimensionsJson) as {lengthCm:number;widthCm:number;heightCm:number};return `${d.lengthCm}×${d.widthCm}×${d.heightCm} cm`}catch{return "à contrôler"}})()}</p>}</TableCell>
                        <TableCell><VariantTag variant={l.product.variant} /></TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(l.qty, l.unit)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtMAD(l.unitPrice)}
                          <span className="text-slate-500"> /{l.unit === "u" ? "u" : l.unit}</span>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {fmtMAD(l.unitPrice * l.qty)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {detail.lines.some(l=>l.kind==="GENERIC") && <section className="space-y-3 rounded-lg border border-sky-200 bg-sky-50 p-3" aria-label="Spécifications hors catalogue">
                <h3 className="text-sm font-semibold text-sky-950">Lignes hors catalogue — configurations contractuelles figées</h3>
                {detail.lines.filter(l=>l.kind==="GENERIC").map(l=>{let snapshot:{template?:string;description?:string;specifications?:string;dimensions?:Record<string,number>;requiresPreparation?:boolean}|null=null
                  try{snapshot=JSON.parse(l.technicalSnapshotJson??"null")}catch{snapshot=null}
                  return <div key={l.id} className="rounded-md border border-sky-200 bg-white p-3 text-xs space-y-1">
                    <p className="font-semibold text-slate-900">{snapshot?.description??l.product.name} <span className="font-normal">· {l.genericTemplate} · ligne #{l.id}</span></p>
                    <p className="text-slate-700">Sans référence catalogue · {fmtQty(l.qty, l.unit)} {l.unit} · {fmtMAD(l.unitPrice)}/{l.unit}</p>
                    <p className="whitespace-pre-wrap text-slate-700">{snapshot?.specifications??"Spécifications figées non disponibles"}</p>
                    {snapshot?.dimensions&&<p className="text-slate-600">Cotes en cm : {snapshot.dimensions.lengthCm} × {snapshot.dimensions.widthCm} × {snapshot.dimensions.heightCm}</p>}
                    <p className="text-slate-600">Visa directeur : {l.priceApprovalStatus==="approved"?`approuvé par ${l.priceApprovedBy??"un responsable habilité"}`:"à obtenir"} · {snapshot?.requiresPreparation===false?"Préparation non requise":"Fabrication/préparation prévue"}</p>
                  </div>
                })}
              </section>}
              {detail.lines.some(l=>l.product.specialNotes) && <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3"><h3 className="text-sm font-semibold text-amber-900">Demandes spéciales à examiner</h3>{detail.lines.filter(l=>l.product.specialNotes).map(l=><div key={l.id} className="text-xs"><p className="font-semibold">{l.productNameSnapshot??l.product.name} · {l.kind==="GENERIC"?"Hors catalogue":l.productSkuSnapshot??l.product.sku}</p><p>Famille : {l.product.family} · Sous-famille : {l.product.subCategory||"—"}</p>{l.product.similarProductSku && <p>Référence proche : {l.product.similarProductSku}</p>}<p className="whitespace-pre-wrap">{l.product.specialNotes}</p></div>)}</section>}
              {detail.lines.some(l=>l.product.specialNotes) && <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-3">
                <h3 className="font-semibold text-amber-900">Autorisation de prix spécial — directeur</h3>
                {detail.lines.filter(l=>l.product.specialNotes).map(l=><div key={l.id} className="rounded bg-white p-3 text-sm space-y-2">
                  <p className="font-medium">{l.productNameSnapshot??l.product.name} · {l.kind==="GENERIC"?"Hors catalogue":l.productSkuSnapshot??l.product.sku}</p>
                  <p>Proposition : {fmtMAD(l.product.unitPrice)} / {l.unit} · <strong>{l.product.specialPriceStatus==="approved"?`Prix autorisé : ${fmtMAD(l.product.specialApprovedUnitPrice ?? l.product.unitPrice)}${l.product.specialPriceApprovedBy?` par ${l.product.specialPriceApprovedBy}`:""}`:l.product.specialPriceStatus==="rejected"?"Prix refusé — nouvelle proposition nécessaire":"En attente de la décision du directeur"}</strong></p>
                  {canSell && l.product.status==="pending_validation" && <div className="space-y-2 rounded-md border border-slate-200 p-2">
                    <p className="text-xs">Proposer un tarif modifié : toute autorisation antérieure sera révoquée. Une commande déjà approuvée ou un devis existant empêche cette modification.</p>
                    <label className="block text-xs font-semibold">Nouveau prix proposé (MAD/{l.unit})<Input type="number" min="0.01" step="0.01" className="mt-1" value={priceValues[l.productId]??String(l.product.unitPrice)} onChange={e=>setPriceValues(old=>({...old,[l.productId]:e.target.value}))}/></label>
                    <label className="block text-xs font-semibold">Motif de la proposition (8 caractères minimum)<Textarea className="mt-1" maxLength={500} value={priceReason} onChange={e=>setPriceReason(e.target.value)}/></label>
                    <Button variant="outline" disabled={pricingBusy||priceReason.trim().length<8} onClick={()=>void proposePrice(l.productId,l.product.unitPrice)}>Soumettre au directeur</Button>
                  </div>}
                  {canDecidePrices && l.product.specialPriceStatus==="pending" && <div className="space-y-2">
                    <label className="block text-xs font-semibold">Prix autorisé (MAD/{l.unit})<Input type="number" min="0.01" step="0.01" className="mt-1" value={priceValues[l.productId]??String(l.product.unitPrice)} onChange={e=>setPriceValues(old=>({...old,[l.productId]:e.target.value}))}/></label>
                    <label className="block text-xs font-semibold">Motif de décision (8 caractères minimum)<Textarea className="mt-1" value={priceReason} onChange={e=>setPriceReason(e.target.value)} maxLength={500}/></label>
                    <label className="block text-xs font-semibold">Mot de passe personnel du directeur
                      <Input type="password" autoComplete="current-password" className="mt-1 max-w-xs" value={directorPassword} onChange={e=>setDirectorPassword(e.target.value)}/>
                    </label>
                    <div className="flex flex-wrap gap-2"><Button disabled={pricingBusy||!directorPassword||priceReason.trim().length<8} onClick={()=>void decidePrice(l.productId,"approve",l.product.unitPrice)}>Autoriser le prix</Button><Button variant="destructive" disabled={pricingBusy||priceReason.trim().length<8} onClick={()=>void decidePrice(l.productId,"reject",l.product.unitPrice)}>Refuser le prix</Button></div>
                  </div>}
                </div>)}
              </section>}
              {detail.lines.some(l=>l.priceApprovalStatus==="pending")&&<section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <h3 className="font-semibold text-amber-900">Prix exceptionnels et lignes génériques — visa du directeur obligatoire</h3>
                <p className="text-xs text-amber-900">Chaque prix est décidé séparément. Les autres lignes restent en attente ; aucun OF avant validation complète. <strong>Le refus d'une ligne rejette toute la commande.</strong></p>
                {canDecidePrices&&<><label className="block text-xs font-semibold">Motif individuel de validation ou refus (8 caractères minimum)
                  <Textarea className="mt-1" placeholder="Motif motivé pour la ligne sélectionnée" value={orderPriceReason} maxLength={500} onChange={e=>setOrderPriceReason(e.target.value)}/></label>
                  <label className="block text-xs font-semibold">Mot de passe personnel pour autoriser le tarif
                    <Input type="password" autoComplete="current-password" className="mt-1 max-w-xs" value={directorPassword} onChange={e=>setDirectorPassword(e.target.value)}/>
                  </label></>}
                <div className="space-y-2">{detail.lines.filter(l=>l.priceApprovalStatus==="pending").map(l=><div key={l.id} className="rounded-md border border-amber-200 bg-white p-3 space-y-2">
                  <p className="text-sm font-medium">Ligne #{l.id} — {l.product.name}</p>
                  <p className="text-xs">{l.kind==="GENERIC"?"Prix spécifique hors catalogue":`Prix catalogue : ${fmtMAD(l.catalogUnitPriceSnapshot??l.product.unitPrice)}`} · Prix proposé : <strong>{fmtMAD(l.unitPrice)}</strong></p>
                  {canDecidePrices&&<div className="flex flex-wrap gap-2"><Button disabled={pricingBusy||!directorPassword||orderPriceReason.trim().length<8} onClick={()=>void decideOrderPrice(detail.id,l.id,"approve-prices")}>Autoriser cette ligne</Button><Button variant="destructive" disabled={pricingBusy||orderPriceReason.trim().length<8} onClick={()=>void decideOrderPrice(detail.id,l.id,"reject-prices")}>Refuser cette ligne (CMD rejetée)</Button></div>}
                </div>)}</div>
              </section>}
              {detail.reviewedBy && <p className="rounded-lg bg-slate-50 p-3 text-xs">Décision par {detail.reviewedBy} : {detail.reviewComment||"sans commentaire"}</p>}
              {canReview && detail.status==="pending_validation" && <div className="space-y-3 rounded-lg border border-violet-300 bg-violet-50 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-violet-900"><ShieldCheck className="size-4"/> Approbation de commande client — responsable habilité</div>
                <p className="text-xs text-violet-800">Vérifier la commande, le client, les quantités et les éventuelles exceptions techniques. Le directeur doit approuver les prix exceptionnels avant ce visa. Aucun OF ni livraison avant cette approbation nominative à quatre yeux.</p>
                <div className="space-y-2">
                  <p className="text-xs text-violet-800">Votre identité est celle du compte connecté. Aucune clé de validation commune n'est nécessaire.</p>
                <div className="space-y-1.5">
                  <Label htmlFor="ov-review-comment">Commentaire / motif du refus</Label>
                  <Textarea id="ov-review-comment" className="min-h-20" maxLength={1500} value={reviewComment} onChange={e=>setReviewComment(e.target.value)}/>
                </div>
                <div className="flex flex-wrap gap-2"><Button disabled={review.isPending||detail.lines.some(l=>l.priceApprovalStatus==="pending" || (l.product.specialNotes&&l.product.specialPriceStatus!=="approved"))} onClick={()=>handleReview(detail,"approve")}>Approuver la commande</Button><Button variant="destructive" disabled={review.isPending||reviewComment.trim().length<5} title={reviewComment.trim().length<5?"Refus : saisir un motif de 5 caractères minimum":undefined} onClick={()=>handleReview(detail,"reject")}>Refuser (motif de 5 caractères min.)</Button></div>
                </div>
              </div>}
              {detail.lines.some(l=>l.product.family==="SALON" && l.unit==="u") && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">Commande historique de salon : unité et prix d’origine conservés. Aucun métrage en ml ne peut être reconstitué sans cotes des pièces.</p>}
              <div className="rounded-lg border p-3">
                <h3 className="mb-2 text-sm font-semibold text-slate-800">Pièces physiques et étiquettes</h3>
                {detail.lines.map((l,i)=><div key={l.id} className="mb-2 text-xs">
                  <p className="font-semibold">Ligne produit {i+1} — {l.product.name}</p>
                  {(l.pieces??[]).map(p=><p key={p.code} className="ml-2 py-0.5 text-slate-600">{l.product.family==="SALON"?`Salon ${p.salonNo} · `:""}{p.partRef || `L${p.elementNo}`} · {p.gabaritCode||"STD"} · {p.linearMeters==null?"unité":`${p.linearMeters} ml`} · {p.code}</p>)}
                </div>)}
                <WorkOrdersPanel order={detail}/>
              </div>
              <p className="text-right text-lg font-bold text-slate-900">
                Total : {fmtMAD(detail.total)}
              </p>
              {canSell && !["shipped","pending_validation","rejected"].includes(detail.status) && <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-semibold">Traitement client : {((detail as OrderDTO & {fulfillmentStatus?:string}).fulfillmentStatus??"open")==="open"?"Ouvert":((detail as OrderDTO & {fulfillmentStatus?:string}).fulfillmentStatus==="on_hold"?"Suspendu":"Reliquat clôturé")}</p>
                {((detail as OrderDTO & {fulfillmentStatus?:string}).fulfillmentStatus??"open")!=="closed"&&<>
                  <Input value={fulfillmentReason} maxLength={500} onChange={e=>setFulfillmentReason(e.target.value)} placeholder="Motif détaillé (10 caractères minimum)" aria-label="Motif de suspension, reprise ou clôture"/>
                  <div className="flex flex-wrap gap-2">
                    {((detail as OrderDTO & {fulfillmentStatus?:string}).fulfillmentStatus??"open")==="open"?<>
                      <Button variant="outline" disabled={fulfillmentBusy||fulfillmentReason.trim().length<10} onClick={()=>void changeFulfillment(detail,"hold")}>Suspendre</Button>
                      <Button variant="outline" disabled={fulfillmentBusy||fulfillmentReason.trim().length<10} onClick={()=>void changeFulfillment(detail,"close")}>Clôturer le reliquat</Button>
                    </>:<Button variant="outline" disabled={fulfillmentBusy||fulfillmentReason.trim().length<10} onClick={()=>void changeFulfillment(detail,"resume")}>Reprendre la commande</Button>}
                  </div>
                </>}
              </div>}
              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="ghost" onClick={() => setDetail(null)}>
                  Fermer
                </Button>
                {canSell && NEXT_LABEL[detail.status] && ((detail as OrderDTO & {fulfillmentStatus?:string}).fulfillmentStatus??"open")==="open" && (
                  <Button
                    variant="primary"
                    className="gap-1.5"
                    disabled={advance.isPending}
                    onClick={() => handleAdvance(detail)}
                  >
                    {detail.status === "new" && <Factory className="size-4" />}
                    {detail.status === "production" && <Warehouse className="size-4" />}
                    {detail.status === "ready" && <Truck className="size-4" />}
                    {NEXT_LABEL[detail.status]}
                    <ChevronRight className="size-4" />
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  )
}
