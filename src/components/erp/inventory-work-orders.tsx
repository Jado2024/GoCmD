"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { api } from "./hooks"
import { WorkOrderLabelSheet, type WorkOrderPrintDTO } from "./label-sheet"

/** File des OF confirmés : aucune information tarifaire révélée au magasinier. */
export function InventoryWorkOrders(){
  const qc=useQueryClient()
  const [busy,setBusy]=useState<number|null>(null)
  const [selected,setSelected]=useState<number|null>(null)
  const [receiptQty,setReceiptQty]=useState<Record<number,string>>({})
  const [page,setPage]=useState(0)
  const queue=useQuery({queryKey:["inventory-work-orders",page],queryFn:()=>api<{items:(WorkOrderPrintDTO & {remainingToReceive?:number;productId?:number})[];pagination:{total:number;take:number;skip:number;hasMore:boolean}}>(`/api/work-orders?take=50&skip=${page*50}`),refetchInterval:30000})
  async function transition(of:WorkOrderPrintDTO,action:"prepare"|"start"|"complete"){
    setBusy(of.id)
    try {
      await api(`/api/work-orders/${of.id}`,{method:"PATCH",body:JSON.stringify({action})})
      toast.success(`${of.ref} : opération enregistrée`)
      await qc.invalidateQueries({queryKey:["inventory-work-orders"]})
      await qc.invalidateQueries({queryKey:["orders"]})
    } catch(e){toast.error(e instanceof Error?e.message:"Action refusée")}
    finally{setBusy(null)}
  }
  async function receive(of:WorkOrderPrintDTO & {remainingToReceive?:number;productId?:number}){
    setBusy(of.id)
    try{
      const qty=Number(receiptQty[of.id]??of.remainingToReceive??0)
      if(!Number.isSafeInteger(qty)||qty<1||qty>(of.remainingToReceive??0))throw Error("Quantité supérieure à l'OF ou non entière")
      const lotCode=`OF-${of.id}-R${Date.now().toString(36).toUpperCase()}`
      const productId=of.productId
      if(!Number.isSafeInteger(productId))throw Error('Produit non identifié')
      await api('/api/sales/finished-stock',{method:'POST',body:JSON.stringify({action:'receive',productId,workOrderId:of.id,qty,lotCode})})
      toast.success(`Réception ${qty} u. créée en quarantaine : libération qualité nécessaire`)
      await qc.invalidateQueries({queryKey:['inventory-work-orders']})
      await qc.invalidateQueries({queryKey:['finished-quality']})
    }catch(e){toast.error(e instanceof Error?e.message:"Réception refusée")}
    finally{setBusy(null)}
  }
  const items=queue.data?.items??[]
  return <Card className="border-emerald-200">
    <CardHeader><CardTitle className="text-base">OF à préparer — magasinier / atelier</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {queue.isLoading&&<p className="text-sm text-slate-500">Chargement des OF confirmés…</p>}
      {queue.isError&&<p className="text-sm text-rose-700">Accès aux OF indisponible.</p>}
      {!queue.isLoading&&!queue.isError&&items.length===0&&<p className="text-sm text-slate-500">{queue.data?.pagination?.hasMore?"Aucun OF actif sur cette page ; consultez la suite.":"Aucun OF à préparer sur cette page."}</p>}
      {items.map(of=><div key={of.id} className="rounded border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><strong className="text-sm">{of.ref}</strong><p className="text-xs text-slate-600">{of.snapshot.orderRef} · {of.snapshot.product.name} · {of.snapshot.client.name} · {of.status}</p>
            {(of.snapshot.product.technicalInstructions||of.snapshot.product.specialNotes)&&<p className="mt-1 text-xs font-semibold text-amber-900">Consignes : {of.snapshot.product.technicalInstructions||of.snapshot.product.specialNotes}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {of.status==="approved"&&<Button variant="outline" size="sm" disabled={busy===of.id} onClick={()=>transition(of,"prepare")}>Préparer depuis stock</Button>}
            {of.status==="approved"&&!of.snapshot.stockTrade&&<Button variant="outline" size="sm" disabled={busy===of.id} onClick={()=>transition(of,"start")}>Démarrer atelier</Button>}
            {of.status==="in_progress"&&<Button variant="outline" size="sm" disabled={busy===of.id} onClick={()=>transition(of,"complete")}>Terminer</Button>}
            {of.status==="completed"&&(of.remainingToReceive??0)>0&&<div className="flex items-center gap-1"><input aria-label={`Quantité réception ${of.ref}`} className="w-16 rounded border px-1 py-1 text-sm" type="number" min="1" max={of.remainingToReceive} step="1" value={receiptQty[of.id]??String(of.remainingToReceive)} onChange={e=>setReceiptQty(x=>({...x,[of.id]:e.target.value}))}/><Button variant="outline" size="sm" disabled={busy===of.id} onClick={()=>void receive(of)}>Réceptionner en quarantaine</Button></div>}
            <Button variant="outline" size="sm" onClick={()=>setSelected(v=>v===of.id?null:of.id)}>{selected===of.id?"Masquer":"Voir OF / étiquettes"}</Button>
          </div>
        </div>
        {selected===of.id&&<div className="mt-3 border-t pt-3"><WorkOrderLabelSheet of={of}/></div>}
      </div>)}
      {!queue.isError && queue.data?.pagination && <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs" aria-label="Pagination des ordres de fabrication">
        <span>Page {page+1} · {queue.data.pagination.total} OF dans la file (pages de 50)</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page===0||queue.isFetching} onClick={()=>{setSelected(null);setPage(v=>Math.max(0,v-1))}}>Précédent</Button>
          <Button variant="outline" size="sm" disabled={!queue.data.pagination.hasMore||queue.isFetching} onClick={()=>{setSelected(null);setPage(v=>v+1)}}>Suivant</Button>
        </div>
      </div>}
    </CardContent>
  </Card>
}
