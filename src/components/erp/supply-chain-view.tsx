"use client"
import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "./hooks"
import {hasRole,hasPermission,type SessionActor} from "@/lib/role-navigation"
import { fmtDate, fmtNum, fmtMAD } from "@/lib/erp-types"
import { LoadError } from "./bits"
import { ListSearch, SortableTh, useListSort } from "./list-controls"
import {DocumentPager} from "./document-pager"
import {useDocumentRegister} from "./use-document-register"
import { SupplierManagement, type SupplierAudit } from "./supplier-management"

type MaterialRef={id:number;ref:string;name:string;unit:string}
type Link={id:number;materialId:number;supplierSku:string|null;unitPrice:number|null;leadTimeDays:number|null;preferred:boolean;material:MaterialRef}
type Supplier={id:number;code:string;name:string;phone:string|null;email:string|null;address:string|null;active:boolean;materials:Link[]}
type PriceSourceOption={type:"CONTRACT"|"QUOTE";id:number;supplierId:number;materialId:number;requestLineId:number|null;ref:string;unitPrice:number;validUntil:string;offeredQty?:number}
type Candidate={requestRef:string;requestLineId:number;materialId:number;materialName:string;unit:string;requested:number;available:number;expectedDate:string|null;createdAt:string;unitPrice:number|null}
type BCLine={id:number;priceSourceType?:"QUOTE"|"CONTRACT"|null;priceSourceRef?:string|null;requestLineId:number|null;materialId:number;qty:number;receivedQty:number;unitPrice:number|null;material:MaterialRef;requestLine?:{request:{ref:string}}|null}
type BC={id:number;ref:string;createdAt:string;status:string;supplierId:number;supplier:Supplier;expectedDate:string|null;note:string|null;lines:BCLine[]}
type BR={id:number;ref:string;deliveryRef:string;operator:string;createdAt:string;supplierOrder:BC;lines:{id:number;acceptedQty:number;rejectedQty:number;lot:string|null;supplierOrderLine:BCLine}[]}
const labelClass="block pb-1 text-xs font-semibold text-slate-600"
const SUPPLIER_ORDER_STATUS: Record<string,string>={draft:"Brouillon",confirmed:"Confirmé",partial:"Partiellement reçu",received:"Reçu",closed:"Clôturé"}
const boxClass="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
function TableSkeleton({rows=3}:{rows?:number}){
  return <div className="space-y-2" role="status" aria-label="Chargement du tableau">{Array.from({length:rows}).map((_,i)=><Skeleton key={i} className="h-10 rounded-md"/>)}</div>
}
function EmptyRow({colSpan,label}:{colSpan:number;label:string}){
  // V18.9.10 (UX-028) : état vide explicite pour chaque tableau.
  return <TableRow><TableCell colSpan={colSpan} className="py-8 text-center text-sm text-slate-500">{label}</TableCell></TableRow>
}
export function SupplyChainView({section,defaultMaterialId}:{section:"suppliers"|"supplier-orders"|"goods-receipts";defaultMaterialId?:number|null}){
 const qc=useQueryClient()
 const session=useQuery({queryKey:["me"],queryFn:()=>api<SessionActor>("/api/me")})
 const canApprove=hasRole(session.data,"approver")
 const canReceive=hasRole(session.data,"receiver")
 const canBuy=hasRole(session.data,"buyer")
 // V18.9.1 (contre-audit A-09) : les tarifs fournisseurs sont null pour les
 // rôles hors achats/approbation/finances (sanitisation côté API).
 const canSeePrices=(hasRole(session.data,"buyer")||hasRole(session.data,"approver")||hasRole(session.data,"finance"))&&hasPermission(session.data,"costs.read")
 const suppliersQ=useQuery({queryKey:["suppliers"],queryFn:()=>api<{items:Supplier[];materials:MaterialRef[];history:SupplierAudit[]}>("/api/suppliers"),enabled:section==="suppliers"||(section==="supplier-orders"&&canBuy)})
 const receivable=section==="goods-receipts"
 const ordersQ=useQuery({
  queryKey:["supplier-orders",receivable?"receivable":"workflow"],
  queryFn:()=>api<{items:BC[];candidates:Candidate[];availableSources:PriceSourceOption[]}>(receivable?"/api/supplier-orders?view=receivable&take=200":"/api/supplier-orders"),
  enabled:receivable?canReceive:section==="supplier-orders"&&canBuy,
 })
 const [receiptLookup,setReceiptLookup]=useState("")
 const receiptLookupQ=useQuery({
  queryKey:["supplier-orders","receipt-lookup",receiptLookup.trim()],
  queryFn:({signal})=>api<{items:BC[]}>(`/api/supplier-orders?view=receivable&take=50&q=${encodeURIComponent(receiptLookup.trim())}`,{signal}),
  enabled:receivable&&canReceive&&receiptLookup.trim().length>=2,
 })
 const suppliers=suppliersQ.data?.items??[]
 const orders=receiptLookup.trim().length>=2?receiptLookupQ.data?.items??[]:ordersQ.data?.items??[]
 const [bcSearch,setBcSearch]=useState("")
 const [bcPage,setBcPage]=useState(1)
 const [bcStatus,setBcStatus]=useState("all")
 const bcSort=useListSort<"ref"|"date"|"montant">("date","asc")
 const bcQ=useDocumentRegister<BC>("supplier-orders",bcSearch,bcPage,section==="supplier-orders",{sort:bcSort.sort.key,dir:bcSort.sort.dir,status:bcStatus})
 const filteredOrders=bcQ.data?.items??[]
 const [brSearch,setBrSearch]=useState("")
 const [brPage,setBrPage]=useState(1)
 const [brDir,setBrDir]=useState("desc")
 const receiptsQ=useDocumentRegister<BR>("goods-receipts",brSearch,brPage,receivable,{dir:brDir})
 const filteredReceipts=receiptsQ.data?.items??[]
 const [busy,setBusy]=useState(false)
 async function submit(path:string,body:unknown,method:"POST"|"PATCH"="POST"){
  if(busy)return false
  setBusy(true)
  try{
   await api(path,{method,body:JSON.stringify(body)})
   await Promise.all([qc.invalidateQueries({queryKey:["buyer-workbench"]}),qc.invalidateQueries({queryKey:["suppliers"]}),qc.invalidateQueries({queryKey:["supplier-orders"]}),qc.invalidateQueries({queryKey:["goods-receipts"]}),qc.invalidateQueries({queryKey:["purchases"]}),qc.invalidateQueries({queryKey:["material-da-followup"]}),qc.invalidateQueries({queryKey:["materials"]}),qc.invalidateQueries({queryKey:["movements"]}),qc.invalidateQueries({queryKey:["dashboard"]})])
   toast.success("Enregistrement effectué et journalisé")
   return true
  }catch(e){toast.error(e instanceof Error?e.message:"Erreur serveur");return false}
  finally{setBusy(false)}
 }
 const [supplierId,setSupplierId]=useState("")
 const [chosen,setChosen]=useState<Record<number,{qty:string;price:string;sourceType:"QUOTE"|"CONTRACT";sourceId:number}>>({})
 const [bcDate,setBcDate]=useState("")
 const [bcNote,setBcNote]=useState("")
 const [closeBcId,setCloseBcId]=useState<number|null>(null)
 const [closeReason,setCloseReason]=useState("")
 async function closeBC(){
  if(closeBcId===null)return
  setBusy(true)
  try{
   await api(`/api/supplier-orders/${closeBcId}`,{method:"PATCH",body:JSON.stringify({action:"close",reason:closeReason})})
   await Promise.all([qc.invalidateQueries({queryKey:["buyer-workbench"]}),qc.invalidateQueries({queryKey:["supplier-orders"]}),qc.invalidateQueries({queryKey:["material-da-followup"]})])
   toast.success("BC clôturé : les reliquats non reçus sont libérés pour un nouveau BC")
   setCloseBcId(null);setCloseReason("")
  }catch(e){toast.error(e instanceof Error?e.message:"Erreur")}
  finally{setBusy(false)}
 }
 const currentSupplier=suppliers.find(s=>s.id===Number(supplierId))
 const candidates=useMemo(()=> (ordersQ.data?.candidates??[]).filter(c=>currentSupplier?.materials.some(l=>l.materialId===c.materialId)).sort((a,b)=>(a.expectedDate??a.createdAt).localeCompare(b.expectedDate??b.createdAt)),[ordersQ.data?.candidates,currentSupplier])
 const [receiptMaterial,setReceiptMaterial]=useState("")
 const [receiptOrder,setReceiptOrder]=useState("")
 const [extraOrderIds,setExtraOrderIds]=useState<number[]>([])
 const [bl,setBl]=useState("")
 const [receiptLines,setReceiptLines]=useState<Record<number,{accepted:string;rejected:string;lot:string;expiry:string}>>({})
 const activeOrders=orders.filter(o=>["confirmed","partial"].includes(o.status))
 const receptionMaterials=Array.from(new Map(activeOrders.flatMap(o=>o.lines.filter(l=>l.qty-l.receivedQty>0.000001).map(l=>[l.materialId,l.material] as const))).values()).sort((a,b)=>a.name.localeCompare(b.name))
 const proposedOrders=activeOrders.filter(o=>!receiptMaterial||o.lines.some(l=>l.materialId===Number(receiptMaterial)&&l.qty-l.receivedQty>0.000001)).sort((a,b)=>(a.expectedDate??a.createdAt??"").localeCompare(b.expectedDate??b.createdAt??""))
 // Ajustement pendant le rendu (pattern React officiel) : présélection de la
 // matière et du BC à l'arrivée depuis une fiche matière, sans effet.
 const [appliedPreset,setAppliedPreset]=useState("")
 const desiredPreset=section==="goods-receipts"&&defaultMaterialId&&!ordersQ.isPending?`${defaultMaterialId}`:""
 if(desiredPreset!==appliedPreset){
  setAppliedPreset(desiredPreset)
  if(desiredPreset){
   setReceiptMaterial(String(defaultMaterialId))
   const matching=activeOrders.filter(b=>b.lines.some(l=>l.materialId===defaultMaterialId&&l.qty-l.receivedQty>0.000001))
   setReceiptOrder(matching.length===1?String(matching[0].id):"")
  }
 }
 const chosenBC=activeOrders.find(o=>o.id===Number(receiptOrder))
 const relatedOrders=[...new Map([...(ordersQ.data?.items??[]),...activeOrders].map(order=>[order.id,order])).values()]
 const selectedBCs=chosenBC?[chosenBC,...relatedOrders.filter(o=>o.supplierId===chosenBC.supplierId&&o.id!==chosenBC.id&&extraOrderIds.includes(o.id))]:[]
 const selectedBCLines=selectedBCs.flatMap(b=>b.lines.filter(l=>l.qty-l.receivedQty>0.000001))
 return <div className="space-y-4">
  {/* V18.9.10 (UX-018) : LoadError unifié (avant : ErrorBox rouge locale). */}
  {(suppliersQ.error||ordersQ.error||receiptsQ.error||bcQ.error)&&<LoadError message="Impossible de charger certaines données achats." onRetry={()=>{if(suppliersQ.isError)void suppliersQ.refetch();if(ordersQ.isError)void ordersQ.refetch();if(receiptsQ.isError)void receiptsQ.refetch();if(bcQ.isError)void bcQ.refetch()}}/>}
  {section==="suppliers"&&<SupplierManagement suppliers={suppliers} materials={suppliersQ.data?.materials??[]} history={suppliersQ.data?.history??[]} busy={busy} loading={suppliersQ.isLoading} canSeePrices={canSeePrices} canManage={canBuy&&hasPermission(session.data,"suppliers.manage")} canApprove={canApprove} submit={submit}/> }
  {section==="supplier-orders"&&<>
   {canBuy&&<section className={boxClass}><h2 className="mb-2 font-semibold">Nouveau bon de commande fournisseur (BC)</h2>
    {/* V18.9.10 (UX-024) : tutoiement corrigé (« Choisis » → « Choisissez »). */}
    <p className="mb-3 text-sm text-slate-600">Choisissez un fournisseur, puis une offre attribuée ou un contrat approuvé. Le tarif indicatif ne suffit pas à établir un BC.</p>
    <a href="/?vue=p2p-advanced" className="mb-3 inline-block text-sm font-semibold text-red-700 underline underline-offset-2">Préparer les consultations et les devis</a>
    <div className="grid gap-3 sm:grid-cols-3">
      <div><label className={labelClass} htmlFor="sc-bc-supplier">Fournisseur *</label>
        <Select value={supplierId} onValueChange={v=>{setSupplierId(v);setChosen({})}}><SelectTrigger id="sc-bc-supplier" className="w-full"><SelectValue placeholder="Sélectionner…"/></SelectTrigger><SelectContent>{suppliers.filter(s=>s.active).map(s=><SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent></Select></div>
      <div><label className={labelClass} htmlFor="sc-bc-date">Date prévue</label><Input id="sc-bc-date" type="date" value={bcDate} onChange={e=>setBcDate(e.target.value)}/></div>
      <div><label className={labelClass} htmlFor="sc-bc-note">Observations</label><Input id="sc-bc-note" value={bcNote} onChange={e=>setBcNote(e.target.value)}/></div></div>
    {currentSupplier&&<div className="mt-3 space-y-3 md:hidden" aria-label="Lignes disponibles pour le BC (mobile)">
      {candidates.map(c=>{const selectedLine=chosen[c.requestLineId];const yes=Boolean(selectedLine);
       const options=(ordersQ.data?.availableSources??[]).filter(o=>o.supplierId===currentSupplier.id&&o.materialId===c.materialId&&(o.type==="CONTRACT"||o.requestLineId===c.requestLineId));
       const selection=options.find(o=>o.id===selectedLine?.sourceId&&o.type===selectedLine?.sourceType);
       return <article key={c.requestLineId} className="space-y-3 rounded-xl border bg-slate-50 p-3">
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-6 shrink-0 accent-emerald-700" disabled={!options.length} checked={yes} onChange={e=>setChosen(p=>{const next={...p};if(e.target.checked){const first=options[0];next[c.requestLineId]={qty:String(Math.min(c.available,first.offeredQty??c.available)),price:String(first.unitPrice),sourceType:first.type,sourceId:first.id}}else delete next[c.requestLineId];return next})}/>
         <span className="min-w-0"><strong className="block text-sm">{c.materialName}</strong><span className="text-xs text-slate-600">{c.requestRef} · Reste : {fmtNum(c.available)} {c.unit}</span></span></label>
        {options.length?<div><label className={labelClass}>Devis / contrat approuvé</label><Select disabled={!yes} value={selection?`${selection.type}:${selection.id}`:""} onValueChange={v=>{const found=options.find(o=>`${o.type}:${o.id}`===v);if(found)setChosen(p=>({...p,[c.requestLineId]:{...p[c.requestLineId],sourceType:found.type,sourceId:found.id,price:String(found.unitPrice),qty:String(Math.min(Number(p[c.requestLineId].qty),found.offeredQty??c.available))}}))}}><SelectTrigger className="w-full"><SelectValue placeholder="Choisir une offre"/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={`${o.type}-${o.id}`} value={`${o.type}:${o.id}`}>{o.type==="QUOTE"?"Devis":"Contrat"} {o.ref} · {fmtMAD(o.unitPrice)}</SelectItem>)}</SelectContent></Select></div>:<p className="text-xs text-amber-700">Aucun tarif approuvé pour cette matière.</p>}
        <div className="grid grid-cols-2 gap-3"><label className="text-xs">Quantité BC ({c.unit})<Input className="mt-1" type="number" min="0.001" max={c.available} step="any" disabled={!yes} value={selectedLine?.qty??""} onChange={e=>setChosen(p=>({...p,[c.requestLineId]:{...p[c.requestLineId],qty:e.target.value}}))}/></label><label className="text-xs">Prix unitaire MAD<Input className="mt-1" type="number" readOnly value={selectedLine?.price??""}/></label></div>
       </article>})}
      {!candidates.length&&<p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Aucune DA validée compatible pour ce fournisseur.</p>}
    </div>}
    {currentSupplier&&<div className="mt-3 hidden overflow-x-auto md:block">
      {/* V18.9.10 (UX-005/UX-011) : tableau shadcn + cases à cocher dans des
          labels cliquables (≥ 24 px) avec aria-label explicite. */}
      <Table className="min-w-[880px]">
        <TableHeader><TableRow>
          <TableHead className="w-20">Ajouter</TableHead><TableHead>DA</TableHead><TableHead>Matière</TableHead><TableHead className="text-right">Reste non commandé</TableHead><TableHead>Date prévue</TableHead><TableHead>Source tarifaire approuvée</TableHead><TableHead>Qté BC</TableHead><TableHead>PU MAD</TableHead>
        </TableRow></TableHeader>
        <TableBody>
        {candidates.map(c=>{const yes=Boolean(chosen[c.requestLineId]);const options=(ordersQ.data?.availableSources??[]).filter(o=>o.supplierId===currentSupplier.id&&o.materialId===c.materialId&&(o.type==="CONTRACT"||o.requestLineId===c.requestLineId));const selected=options.find(o=>o.id===chosen[c.requestLineId]?.sourceId&&o.type===chosen[c.requestLineId]?.sourceType);return <TableRow key={c.requestLineId}>
          <TableCell><label className="flex cursor-pointer items-center justify-center py-1"><input type="checkbox" className="size-6 accent-emerald-700" aria-label={`Ajouter la ligne DA ${c.requestRef} — ${c.materialName}`} disabled={!options.length} checked={yes} onChange={e=>setChosen(p=>{const n={...p};if(e.target.checked){const first=options[0];n[c.requestLineId]={qty:String(Math.min(c.available,first.offeredQty??c.available)),price:String(first.unitPrice),sourceType:first.type,sourceId:first.id}}else delete n[c.requestLineId];return n})}/></label></TableCell>
          <TableCell className="font-mono text-xs">{c.requestRef}</TableCell><TableCell>{c.materialName} ({c.unit})</TableCell><TableCell className="text-right tabular-nums">{fmtNum(c.available)}</TableCell><TableCell>{fmtDate(c.expectedDate)}</TableCell>
          <TableCell>{options.length?<Select disabled={!yes} value={selected?`${selected.type}:${selected.id}`:""} onValueChange={v=>{const found=options.find(o=>`${o.type}:${o.id}`===v);if(found)setChosen(p=>({...p,[c.requestLineId]:{...p[c.requestLineId],sourceType:found.type,sourceId:found.id,price:String(found.unitPrice),qty:String(Math.min(Number(p[c.requestLineId].qty),found.offeredQty??c.available))}}))}}><SelectTrigger className="min-w-52"><SelectValue placeholder="Choisir devis / contrat"/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={`${o.type}-${o.id}`} value={`${o.type}:${o.id}`}>{o.type==="QUOTE"?"Devis":"Contrat"} {o.ref} · {fmtMAD(o.unitPrice)}</SelectItem>)}</SelectContent></Select>:<span className="text-xs text-amber-700">Devis ou contrat requis</span>}</TableCell>
          <TableCell><Input className="w-28" type="number" min="0.001" max={c.available} step="any" disabled={!yes} value={chosen[c.requestLineId]?.qty??""} onChange={e=>setChosen(p=>({...p,[c.requestLineId]:{...p[c.requestLineId],qty:e.target.value}}))}/></TableCell>
          <TableCell><Input className="w-28" type="number" readOnly aria-label="Prix issu du devis ou contrat approuvé" value={chosen[c.requestLineId]?.price??""}/></TableCell>
        </TableRow>})}
        {!candidates.length&&<EmptyRow colSpan={8} label="Aucune DA validée non commandée pour les matières référencées chez ce fournisseur."/>}
        </TableBody>
      </Table>
    </div>}
    <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="primary" disabled={busy||!supplierId||!Object.keys(chosen).length} onClick={async()=>{const lines=Object.entries(chosen).map(([id,v])=>({requestLineId:Number(id),qty:Number(v.qty),unitPrice:Number(v.price),sourceType:v.sourceType,sourceId:v.sourceId}));if(lines.some(l=>!(l.qty>0)||!Number.isFinite(l.qty)||l.unitPrice<0||!Number.isFinite(l.unitPrice))){toast.error("Vérifier quantités et prix");return}if(await submit("/api/supplier-orders",{supplierId:Number(supplierId),expectedDate:bcDate||undefined,note:bcNote,lines})){setChosen({});setBcNote("")}}}>Enregistrer le BC</Button><span className="text-xs text-slate-500">Chaque ligne de BC conserve sa source tarifaire et sa référence. Les DA peuvent être réparties entre fournisseurs.</span></div>
   </section>}
   {!canBuy&&<p role="note" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">La préparation des BC est réservée au rôle acheteur. Vous pouvez consulter ou approuver selon vos droits.</p>}
   <section className={boxClass}>
     <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
       <h2 className="font-semibold">Bons de commande fournisseurs ({bcQ.data?.pagination.total??0})</h2>
     </div>
     {/* V18.9.10 (UX-019) : recherche + tri locaux sur les BC chargés. */}
     <ListSearch className="mb-3" value={bcSearch} onChange={v=>{setBcSearch(v);setBcPage(1)}} placeholder="Rechercher un BC, une DA, un fournisseur ou une matière…" shown={filteredOrders.length} total={bcQ.data?.pagination.total??0} unit="BC" global/>
     <div className="mb-3 flex flex-wrap items-end gap-2">
      <label className="text-xs">Statut du BC<Select value={bcStatus} onValueChange={v=>{setBcStatus(v);setBcPage(1)}}><SelectTrigger className="mt-1 w-48" aria-label="Statut du BC"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Tous les statuts</SelectItem>{Object.entries(SUPPLIER_ORDER_STATUS).map(([value,label])=><SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
     </div>
     {bcQ.isPending?<TableSkeleton rows={4}/>:<div className="space-y-3 md:hidden" aria-label="Bons de commande (mobile)">
      {filteredOrders.map(b=><article key={b.id} className="space-y-2 rounded-xl border bg-white p-3 shadow-sm">
       <div className="flex flex-wrap items-start justify-between gap-2"><strong className="font-mono text-sm">{b.ref}</strong><span className="rounded bg-slate-100 px-2 py-1 text-xs">{SUPPLIER_ORDER_STATUS[b.status]??b.status}</span></div>
       <p className="text-sm font-medium">{b.supplier.name}</p>
       <p className="text-xs text-slate-600">{b.lines.length} ligne(s) · Livraison : {fmtDate(b.expectedDate)}</p>
       {canSeePrices&&<p className="text-sm font-semibold">{fmtMAD(b.lines.reduce((n,l)=>n+l.qty*(l.unitPrice??0),0))}</p>}
       <div className="flex flex-wrap gap-2 border-t pt-2">
        {canSeePrices&&b.status!=="draft"&&<Button asChild variant="outline" size="sm"><a href={`/api/supplier-orders/${b.id}/pdf`} target="_blank" rel="noopener noreferrer">PDF du BC</a></Button>}
        {canApprove&&b.status==="draft"&&<Button size="sm" onClick={async()=>{try{await api(`/api/supplier-orders/${b.id}`,{method:"PATCH",body:JSON.stringify({action:"approve"})});await Promise.all([qc.invalidateQueries({queryKey:["supplier-orders"]}),qc.invalidateQueries({queryKey:["material-da-followup"]})]);toast.success("BC approuvé")}catch(e){toast.error(e instanceof Error?e.message:"Approbation impossible")}}}>Approuver</Button>}
        {canApprove&&["confirmed","partial"].includes(b.status)&&<Button variant="outline" size="sm" onClick={()=>setCloseBcId(b.id)}>Clôturer le solde</Button>}
       </div></article>)}
      {!filteredOrders.length&&<p className="text-center text-sm text-slate-600">Aucun bon de commande.</p>}
     </div>}
     {bcQ.isPending?null:<div className="hidden overflow-x-auto md:block">
     <Table className="min-w-[900px]">
       <TableHeader><TableRow>
         <SortableTh label="BC" field="ref" sort={bcSort.sort} onToggle={field=>{bcSort.toggle(field);setBcPage(1)}}/>
         <TableHead>Fournisseur</TableHead><TableHead>Justificatif tarifaire</TableHead><TableHead>Statut</TableHead><TableHead>Réception</TableHead>
         {canSeePrices?<SortableTh label="Montant" field="montant" sort={bcSort.sort} onToggle={field=>{bcSort.toggle(field);setBcPage(1)}} align="right"/>:<TableHead className="text-right">Montant</TableHead>}
         <SortableTh label="Livraison prévue" field="date" sort={bcSort.sort} onToggle={field=>{bcSort.toggle(field);setBcPage(1)}}/>
         <TableHead>Action</TableHead>
       </TableRow></TableHeader>
       <TableBody>
       {filteredOrders.map(b=><TableRow key={b.id}>
         <TableCell className="font-semibold">{b.ref}</TableCell><TableCell>{b.supplier.name}</TableCell><TableCell className="text-xs">{canSeePrices?b.lines.map(l=>l.priceSourceRef?`${l.priceSourceType==="QUOTE"?"Devis":"Contrat"} ${l.priceSourceRef}`:"Historique sans source P5.11").join(" ; "):"—"}</TableCell><TableCell>{SUPPLIER_ORDER_STATUS[b.status] ?? b.status}</TableCell><TableCell>{b.lines.filter(l=>l.receivedQty>=l.qty-0.000001).length} / {b.lines.length} lignes soldées</TableCell><TableCell className="text-right tabular-nums">{canSeePrices?fmtMAD(b.lines.reduce((n,l)=>n+l.qty*(l.unitPrice??0),0)):"—"}</TableCell><TableCell>{fmtDate(b.expectedDate)}</TableCell>
         <TableCell><div className="flex flex-wrap gap-2">{canSeePrices&&b.status!=="draft"&&<Button asChild size="sm" variant="outline"><a href={`/api/supplier-orders/${b.id}/pdf`} target="_blank" rel="noopener noreferrer">PDF</a></Button>}{canApprove&&b.status==="draft"&&<Button size="sm" title="Approuver le bon de commande" onClick={async()=>{try{await api(`/api/supplier-orders/${b.id}`,{method:"PATCH",body:JSON.stringify({action:"approve"})});qc.invalidateQueries({queryKey:["supplier-orders"]});qc.invalidateQueries({queryKey:["purchases"]});qc.invalidateQueries({queryKey:["material-da-followup"]});toast.success("BC approuvé") }catch(e){toast.error(e instanceof Error?e.message:"Approbation impossible")}}}>Approuver</Button>}{canApprove&&["confirmed","partial"].includes(b.status)&&<Button size="sm" variant="outline" onClick={()=>setCloseBcId(b.id)}>Clôturer le solde</Button>}</div></TableCell>
       </TableRow>)}
       {!filteredOrders.length&&<EmptyRow colSpan={8} label={bcSearch?`Aucun BC ne correspond à « ${bcSearch} ».`:"Aucun bon de commande enregistré."}/>}
       </TableBody>
     </Table>
     </div>}
     <DocumentPager page={bcPage} data={bcQ.data?.pagination} onPage={setBcPage} label="Bons de commande"/>
   </section>
   {closeBcId!==null&&<section className={boxClass}>
    <h3 className="mb-2 font-semibold">Clôture anticipée du solde BC</h3>
    <p className="mb-3 text-sm text-slate-600">Aucune entrée en stock. Les quantités non reçues redeviennent disponibles pour un autre BC.</p>
    <div className="grid gap-3 sm:grid-cols-2"><p className="text-xs text-slate-500">La clôture est attribuée automatiquement au compte connecté.</p><div><label className={labelClass} htmlFor="sc-close-reason">Motif (10 caractères minimum) *</label><Input id="sc-close-reason" value={closeReason} onChange={e=>setCloseReason(e.target.value)}/></div></div>
    <div className="mt-3 flex gap-2"><Button disabled={busy||closeReason.trim().length<10} onClick={closeBC}>Confirmer la clôture</Button><Button variant="outline" onClick={()=>setCloseBcId(null)}>Annuler</Button></div>
   </section>}
  </>}
  {section==="goods-receipts"&&<>
   {!canReceive&&<p role="note" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">Lecture seule : l’acheteur consulte les BR et relance les fournisseurs. La validation physique d’une réception appartient au réceptionnaire.</p>}
   {canReceive&&<section className={boxClass}><h2 className="mb-2 font-semibold">Nouveau bon de réception (BR)</h2><p className="mb-3 text-sm text-slate-600">Sélectionner le BC correspondant au BL fournisseur. Seules les quantités acceptées augmentent le stock disponible. Les refusées passent en quarantaine.</p>
    <div className="mb-3 flex flex-wrap items-end gap-2">
     <label className="block w-full max-w-md text-xs">Chercher dans tous les BC ouverts
       <Input className="mt-1" type="search" value={receiptLookup} disabled={!!receiptOrder} maxLength={100}
        onChange={e=>{setReceiptLookup(e.target.value);setReceiptMaterial("");setExtraOrderIds([])}} placeholder="Référence BC ou DA, fournisseur, matière…"/>
     </label>
     {receiptOrder&&<Button size="sm" variant="outline" onClick={()=>{setReceiptOrder("");setReceiptLines({});setExtraOrderIds([])}}>Changer le BC</Button>}
     {receiptLookupQ.isFetching&&<p role="status" className="text-xs">Recherche des BC…</p>}
     {receiptLookupQ.isError&&<Button size="sm" variant="outline" onClick={()=>void receiptLookupQ.refetch()}>Relancer la recherche</Button>}
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>div]:min-w-0">
      <div><label className={labelClass} htmlFor="sc-receipt-material">Matière livrée (recherche automatique)</label>
        <Select value={receiptMaterial} onValueChange={mid=>{setReceiptMaterial(mid);setReceiptLines({});const matches=activeOrders.filter(b=>b.lines.some(l=>l.materialId===Number(mid)&&l.qty-l.receivedQty>0.000001));setReceiptOrder(mid&&matches.length===1?String(matches[0].id):"")}}><SelectTrigger id="sc-receipt-material" className="w-full"><SelectValue placeholder="Toutes les matières"/></SelectTrigger><SelectContent>{receptionMaterials.map(m=><SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}</SelectContent></Select></div>
      <div><label className={labelClass} htmlFor="sc-receipt-order">BC proposé selon échéance *</label>
        <Select value={receiptOrder} onValueChange={v=>{setReceiptOrder(v);setReceiptLines({});setExtraOrderIds([])}}><SelectTrigger id="sc-receipt-order" className="w-full"><SelectValue placeholder={proposedOrders.length>1?"Choisir parmi les BC correspondants…":"Sélectionner un BC…"}/></SelectTrigger><SelectContent>{proposedOrders.map(b=><SelectItem key={b.id} value={String(b.id)}>{b.ref} · {b.supplier.name} · {fmtDate(b.expectedDate)}</SelectItem>)}</SelectContent></Select>
        <p className="pt-1 text-xs text-slate-500">{receiptMaterial&&proposedOrders.length===1?"Un seul BC correspondant : présélectionné.":receiptMaterial&&proposedOrders.length>1?`${proposedOrders.length} BC compatibles : confirmation nécessaire.`:"BC ouverts triés par échéance puis ancienneté."}</p></div>
      <div><label className={labelClass} htmlFor="sc-receipt-bl">N° BL fournisseur *</label><Input id="sc-receipt-bl" value={bl} onChange={e=>setBl(e.target.value)} placeholder="BL-2026-001"/></div>
      <div className="text-xs text-slate-500">Réceptionnaire : compte connecté, enregistré côté serveur.</div>
    </div>
    {chosenBC&&<div className="mt-3 rounded-md border bg-slate-50 p-2 text-xs">
      <strong>Autres BC du même fournisseur couverts par ce BL (facultatif) :</strong>
      <div className="mt-2 flex flex-wrap gap-3">{relatedOrders.filter(o=>o.supplierId===chosenBC.supplierId&&o.id!==chosenBC.id).map(b=><label key={b.id} className="flex cursor-pointer items-center gap-2 py-1"><input type="checkbox" className="size-5 accent-emerald-700" aria-label={`Inclure le BC ${b.ref}`} checked={extraOrderIds.includes(b.id)} onChange={e=>{setExtraOrderIds(p=>e.target.checked?[...p,b.id]:p.filter(id=>id!==b.id));setReceiptLines({})}}/>{b.ref}</label>)}</div>
      <p className="mt-1">Une seule référence BL fournisseur peut couvrir plusieurs BC, avec un BR par BC.</p>
    </div>}
    {chosenBC&&<div><div className="mt-3 space-y-3 md:hidden" aria-label="Contrôle des matières reçues (mobile)">
      {selectedBCLines.map(l=><article key={l.id} className="space-y-3 rounded-xl border bg-slate-50 p-3">
       <div><strong className="text-sm">{l.material.name}</strong><p className="text-xs text-slate-600">Reste : {fmtNum(l.qty-l.receivedQty)} {l.material.unit}</p></div>
       <div className="grid grid-cols-2 gap-3">
        <label className="text-xs">Quantité acceptée<Input aria-label={`Quantité acceptée ${l.material.name} pour ${l.id}`} className="mt-1" type="number" min="0" step="any" value={receiptLines[l.id]?.accepted??"0"} onChange={e=>setReceiptLines(p=>({...p,[l.id]:{...p[l.id],accepted:e.target.value,rejected:p[l.id]?.rejected??"0",lot:p[l.id]?.lot??"",expiry:p[l.id]?.expiry??""}}))}/></label>
        <label className="text-xs">Quantité refusée<Input aria-label={`Quantité refusée ${l.material.name} pour ${l.id}`} className="mt-1" type="number" min="0" step="any" value={receiptLines[l.id]?.rejected??"0"} onChange={e=>setReceiptLines(p=>({...p,[l.id]:{...p[l.id],rejected:e.target.value,accepted:p[l.id]?.accepted??"0",lot:p[l.id]?.lot??"",expiry:p[l.id]?.expiry??""}}))}/></label>
        <label className="text-xs">N° lot<Input className="mt-1" value={receiptLines[l.id]?.lot??""} onChange={e=>setReceiptLines(p=>({...p,[l.id]:{...p[l.id],lot:e.target.value,accepted:p[l.id]?.accepted??"0",rejected:p[l.id]?.rejected??"0",expiry:p[l.id]?.expiry??""}}))}/></label>
        <label className="text-xs">Péremption (si utile)<Input className="mt-1" type="date" value={receiptLines[l.id]?.expiry??""} onChange={e=>setReceiptLines(p=>({...p,[l.id]:{...p[l.id],expiry:e.target.value,accepted:p[l.id]?.accepted??"0",rejected:p[l.id]?.rejected??"0",lot:p[l.id]?.lot??""}}))}/></label>
       </div>
      </article>)}
     </div><div className="mt-1 hidden overflow-x-auto md:block">
      <Table className="min-w-[790px]">
        <TableHeader><TableRow><TableHead>Matière</TableHead><TableHead className="text-right">Reste à recevoir</TableHead><TableHead>Accepté</TableHead><TableHead>Refusé</TableHead><TableHead>Lot</TableHead><TableHead>Péremption (facultatif)</TableHead></TableRow></TableHeader>
        <TableBody>{selectedBCLines.map(l=><TableRow key={l.id}>
          <TableCell>{l.material.name} ({l.material.unit})</TableCell><TableCell className="text-right tabular-nums">{fmtNum(l.qty-l.receivedQty)}</TableCell>
          <TableCell><Input aria-label={`Quantité acceptée ${l.material.name} pour ${l.id}`} type="number" min="0" step="any" className="w-28" value={receiptLines[l.id]?.accepted??"0"} onChange={e=>setReceiptLines(p=>({...p,[l.id]:{...p[l.id],accepted:e.target.value,rejected:p[l.id]?.rejected??"0",lot:p[l.id]?.lot??"",expiry:p[l.id]?.expiry??""}}))}/></TableCell>
          <TableCell><Input aria-label={`Quantité refusée ${l.material.name} pour ${l.id}`} type="number" min="0" step="any" className="w-28" value={receiptLines[l.id]?.rejected??"0"} onChange={e=>setReceiptLines(p=>({...p,[l.id]:{...p[l.id],rejected:e.target.value,accepted:p[l.id]?.accepted??"0",lot:p[l.id]?.lot??"",expiry:p[l.id]?.expiry??""}}))}/></TableCell>
          <TableCell><Input aria-label={`Référence lot ${l.material.name} pour ${l.id}`} className="w-28" value={receiptLines[l.id]?.lot??""} onChange={e=>setReceiptLines(p=>({...p,[l.id]:{...p[l.id],lot:e.target.value,accepted:p[l.id]?.accepted??"0",rejected:p[l.id]?.rejected??"0",expiry:p[l.id]?.expiry??""}}))}/></TableCell>
          <TableCell><Input aria-label={`Date de péremption ${l.material.name} pour ${l.id}`} type="date" className="w-36" value={receiptLines[l.id]?.expiry??""} onChange={e=>setReceiptLines(p=>({...p,[l.id]:{...p[l.id],expiry:e.target.value,accepted:p[l.id]?.accepted??"0",rejected:p[l.id]?.rejected??"0",lot:p[l.id]?.lot??""}}))}/></TableCell>
        </TableRow>)}</TableBody>
      </Table>
      <p className="mt-1 text-xs text-slate-500">Date de péremption : recommandée pour les matières à durée de vie limitée (colles, additifs) ; elle active le conseil FEFO et les alertes de lot.</p></div></div>}
    <Button variant="primary" className="mt-4" disabled={busy||!chosenBC||bl.trim().length<2} onClick={async()=>{if(!chosenBC)return;const lines=selectedBCLines.map(l=>({supplierOrderLineId:l.id,acceptedQty:Number(receiptLines[l.id]?.accepted??0),rejectedQty:Number(receiptLines[l.id]?.rejected??0),lot:receiptLines[l.id]?.lot??"",expiresAt:receiptLines[l.id]?.expiry||undefined})).filter(l=>l.acceptedQty+l.rejectedQty>0);if(!lines.length||lines.some(l=>l.acceptedQty<0||l.rejectedQty<0)||lines.some(l=>l.acceptedQty+l.rejectedQty>selectedBCLines.find(x=>x.id===l.supplierOrderLineId)!.qty-selectedBCLines.find(x=>x.id===l.supplierOrderLineId)!.receivedQty+0.000001)){toast.error("Quantités invalides ou supérieures au solde");return}if(await submit("/api/goods-receipts",{supplierOrderId:chosenBC.id,deliveryRef:bl.trim(),lines})){setBl("");setReceiptLines({});setExtraOrderIds([])}}}>Valider le BR et mettre à jour le stock</Button>
   </section>}
   <section className={boxClass}>
     <h2 className="mb-3 font-semibold">Historique des BR ({receiptsQ.data?.pagination.total??0})</h2>
     {/* V18.9.10 (UX-019) : recherche locale sur les BR chargés. */}
     <ListSearch className="mb-3" value={brSearch} onChange={v=>{setBrSearch(v);setBrPage(1)}} placeholder="Rechercher un BR, BL, BC, fournisseur ou lot…" shown={filteredReceipts.length} total={receiptsQ.data?.pagination.total??0} unit="BR" global/>
     <label className="mb-3 block w-48 text-xs">Tri des réceptions<Select value={brDir} onValueChange={v=>{setBrDir(v);setBrPage(1)}}><SelectTrigger className="mt-1" aria-label="Tri des réceptions"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="desc">Plus récentes</SelectItem><SelectItem value="asc">Plus anciennes</SelectItem></SelectContent></Select></label>
     {receiptsQ.isPending?<TableSkeleton rows={3}/>:<div className="space-y-3 md:hidden" aria-label="Historique des BR (mobile)">
      {filteredReceipts.map(b=><article key={b.id} className="space-y-2 rounded-lg border p-3 text-sm">
       <div className="flex flex-wrap items-center justify-between gap-2"><strong className="font-mono">{b.ref}</strong><Button variant="outline" size="sm" asChild><a href={`/api/goods-receipts/${b.id}/pdf`} target="_blank" rel="noopener noreferrer">PDF</a></Button></div>
       <p>{b.supplierOrder.supplier.name} · BC {b.supplierOrder.ref}</p><p className="text-xs text-slate-600">BL {b.deliveryRef} · {fmtDate(b.createdAt)}</p>
       {b.lines.map(l=><p key={l.id} className="text-xs">{l.supplierOrderLine.material.name} : {fmtNum(l.acceptedQty)} accepté · {fmtNum(l.rejectedQty)} refusé</p>)}
      </article>)}
      {!filteredReceipts.length&&<p className="text-center text-sm text-slate-600">Aucun BR enregistré.</p>}
     </div>}
     {receiptsQ.isPending?null:<div className="hidden overflow-x-auto md:block">
     <Table className="min-w-[700px]">
       <TableHeader><TableRow><TableHead>Référence BR</TableHead><TableHead>BC / Fournisseur</TableHead><TableHead>BL</TableHead><TableHead>Date</TableHead><TableHead>Réceptionnaire</TableHead><TableHead>Lignes</TableHead></TableRow></TableHeader>
       <TableBody>
       {filteredReceipts.map(b=><TableRow key={b.id}><TableCell className="font-semibold"><a className="text-red-700 underline" href={`/api/goods-receipts/${b.id}/pdf`} target="_blank" rel="noopener noreferrer">{b.ref} · PDF</a></TableCell><TableCell>{b.supplierOrder.ref} / {b.supplierOrder.supplier.name}</TableCell><TableCell>{b.deliveryRef}</TableCell><TableCell>{fmtDate(b.createdAt)}</TableCell><TableCell>{b.operator}</TableCell><TableCell>{b.lines.map(l=>`${l.supplierOrderLine.material.name}: ${fmtNum(l.acceptedQty)} accepté, ${fmtNum(l.rejectedQty)} refusé`).join(" ; ")}</TableCell></TableRow>)}
       {!filteredReceipts.length&&<EmptyRow colSpan={6} label={brSearch?`Aucun BR ne correspond à « ${brSearch} ».`:"Aucun bon de réception enregistré."}/>}
       </TableBody>
     </Table>
     </div>}
     <DocumentPager page={brPage} data={receiptsQ.data?.pagination} onPage={setBrPage} label="Bons de réception"/>
   </section>
  </>}
 </div>
}
