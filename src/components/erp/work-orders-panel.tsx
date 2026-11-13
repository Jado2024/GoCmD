"use client"
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Factory, FileCheck2 } from "lucide-react"
import { api } from "./hooks"
import { Button } from "@/components/ui/button"
import { hasRole, hasPermission, type SessionActor } from "@/lib/role-navigation"
import type { OrderDTO } from "@/lib/erp-types"
import { canGenerateOF } from "@/lib/work-order-labels"
import { WorkOrderLabelSheet, type WorkOrderPrintDTO } from "./label-sheet"

const LABELS:Record<string,string>={draft:"Brouillon",approved:"Approuvé",in_progress:"En cours",completed:"Terminé",cancelled:"Annulé"}
/** R5 : l'UI suit le contrat figé, sans déduire un OF du catalogue. */
function preparationDecision(line:OrderDTO["lines"][number]):boolean|null {
  if(line.kind!=="GENERIC")return true
  try {
    const snapshot=JSON.parse(line.technicalSnapshotJson??"null") as {kind?:string;requiresPreparation?:unknown}|null
    return snapshot?.kind==="GENERIC" && typeof snapshot.requiresPreparation==="boolean"
      ? snapshot.requiresPreparation : null
  } catch { return null }
}
export function WorkOrdersPanel({order}:{order:OrderDTO}) {
  const qc=useQueryClient()
  const [busy,setBusy]=useState(false)
  const [selectedId,setSelectedId]=useState<number|null>(null)
  const {data:session}=useQuery({queryKey:["me"],queryFn:()=>api<SessionActor>("/api/me"),staleTime:60000})
  // Le responsable approuve l'OF sans devoir cumuler le rôle commercial.
  const manager=hasRole(session,"approver")&&hasPermission(session,"sales.approve")
  const operator=hasRole(session,"inventory")&&hasPermission(session,"stock.move")
  const query=useQuery({queryKey:["work-orders",order.id],
    queryFn:()=>api<{items:WorkOrderPrintDTO[]}>(`/api/work-orders?orderId=${order.id}&take=100`),staleTime:0})
  const items=query.data?.items??[]
  const selected=items.find(w=>w.id===selectedId)??null
  async function create(orderLineId:number){
    if(busy)return
    setBusy(true)
    try {
      const result=await api<{workOrder:WorkOrderPrintDTO}>("/api/work-orders",{method:"POST",body:JSON.stringify({orderLineId})})
      toast.success(`${result.workOrder.ref} créé en brouillon`)
      await qc.invalidateQueries({queryKey:["work-orders",order.id]})
      setSelectedId(result.workOrder.id)
    } catch(err){toast.error(err instanceof Error?err.message:"Création OF impossible")}
    finally{setBusy(false)}
  }
  async function transition(id:number,action:"approve"|"start"|"complete"|"prepare"|"cancel"|"reactivate"){
    if(busy)return
    const reason=action==="cancel"||action==="reactivate"?window.prompt("Motif de l'opération (10 caractères minimum) :")?.trim():undefined
    if((action==="cancel"||action==="reactivate")&&(!reason||reason.length<10))return
    setBusy(true)
    try{
      await api(`/api/work-orders/${id}`,{method:"PATCH",body:JSON.stringify({action,...(reason?{reason}:{})})})
      toast.success("Statut OF mis à jour")
      await qc.invalidateQueries({queryKey:["work-orders",order.id]})
    }catch(err){toast.error(err instanceof Error?err.message:"Transition OF impossible")}
    finally{setBusy(false)}
  }
  return <div className="space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Factory className="size-4"/> Ordres de fabrication (OF)</h3>
      <span className="text-xs text-slate-500">OF après approbation, seulement si préparation nécessaire · 8 étiquettes A4/page</span>
    </div>
    {query.isPending&&<p className="text-xs text-slate-500">Chargement des OF…</p>}
    {query.isError&&<p className="text-xs text-rose-700">OF indisponibles : vérifier la migration et les permissions.</p>}
    {order.lines.map((line,index)=>{
      const existing=items.find(of=>of.orderLineId===line.id)
      const needsPreparation=preparationDecision(line)
      const eligible=needsPreparation===true && canGenerateOF(order.status,(order as OrderDTO&{fulfillmentStatus?:string}).fulfillmentStatus??"open",line.pieces?.length??0,line.product.materialId!=null)
      return <div key={line.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0">
        <div className="min-w-0">
          <p className="text-xs font-semibold">Ligne {index+1} · {line.product.name}</p>
          <p className="text-xs text-slate-500">{line.pieces?.length??0} pièce(s) physiques · {existing?`${existing.ref} · ${LABELS[existing.status]}`:needsPreparation===false?"Aucun OF requis":needsPreparation===null?"Snapshot incomplet : contrôle requis":"OF à régulariser"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {manager&&!existing&&eligible&&<Button size="sm" disabled={busy||query.isPending} onClick={()=>void create(line.id)}>Régulariser OF</Button>}
          {existing&&<Button variant="outline" size="sm" onClick={()=>setSelectedId(existing.id)}>Consulter</Button>}
          {existing&&operator&&existing.status==="approved"&&(existing.snapshot.stockTrade||existing.snapshot.product.family==="MATELAS"||existing.snapshot.product.family==="PLAQUE_MOUSSE")&&<Button size="sm" disabled={busy} onClick={()=>void transition(existing.id,"prepare")}>Préparer le stock</Button>}
          {existing&&manager&&existing.status==="draft"&&!existing.snapshot.stockTrade&&<Button size="sm" disabled={busy||existing.createdBy===session?.username} title={existing.createdBy===session?.username?"Validation à deux personnes requise":undefined} onClick={()=>void transition(existing.id,"approve")}>Approuver fabrication</Button>}
          {existing&&operator&&existing.status==="approved"&&!existing.snapshot.stockTrade&&<Button size="sm" disabled={busy} onClick={()=>void transition(existing.id,"start")}>Démarrer</Button>}
          {existing&&operator&&existing.status==="in_progress"&&<Button size="sm" disabled={busy} onClick={()=>void transition(existing.id,"complete")}>Terminer</Button>}
          {existing&&manager&&["draft","approved"].includes(existing.status)&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void transition(existing.id,"cancel")}>Annuler</Button>}
          {existing&&manager&&existing.status==="cancelled"&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void transition(existing.id,"reactivate")}>Réactiver</Button>}
        </div>
      </div>
    })}
    {selected&&<div className="space-y-2 rounded-lg border border-slate-400 p-2">
      <div className="flex items-center justify-between gap-2"><p className="flex items-center gap-1 text-sm font-bold"><FileCheck2 className="size-4"/>{selected.ref} · {LABELS[selected.status]}</p><Button size="sm" variant="outline" onClick={()=>setSelectedId(null)}>Masquer</Button></div>
      <WorkOrderLabelSheet of={selected}/>
    </div>}
  </div>
}
