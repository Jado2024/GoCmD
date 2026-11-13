"use client"
import {useState} from "react"
import {toast} from "sonner"
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {api} from "./hooks"
import {isValidPurchaseQuantity} from "@/lib/purchase-quantity"

type Line={id:number,qty:number,unit:string,amountCents:number,deliveryLine:{orderLine:{product:{name:string}}}}
export function ClientCreditLines({invoiceId,lines,onComplete}:{invoiceId:number,lines:Line[],onComplete:()=>void}){
 const [quantities,setQuantities]=useState<Record<number,string>>({})
 const [reason,setReason]=useState("")
 const [busy,setBusy]=useState(false)
 const selected=lines.flatMap(line=>{
  const raw=(quantities[line.id]??"").trim().replace(",",".")
  if(!raw)return []
  const qty=Number(raw)
  return [{invoiceLineId:line.id,qty,valid:isValidPurchaseQuantity(qty,line.unit)&&qty<=line.qty+1e-7}]
 })
 const valid=selected.length>0&&selected.every(x=>x.valid)&&reason.trim().length>=5
 async function submit(){
  if(!valid||busy)return
  setBusy(true)
  try{
   await api("/api/sales",{method:"POST",body:JSON.stringify({action:"credit-lines",invoiceId,reason:reason.trim(),lines:selected.map(({invoiceLineId,qty})=>({invoiceLineId,qty}))})})
   toast.success("Avoir détaillé en attente de validation par une autre personne")
   setQuantities({});setReason("");onComplete()
  }catch(e){toast.error(e instanceof Error?e.message:"Avoir refusé")}
  finally{setBusy(false)}
 }
 return <div className="mt-3 space-y-2 rounded border border-emerald-200 bg-white p-3 text-sm">
  <h3 className="font-semibold">Préparer un avoir par ligne d'article</h3>
  <p className="text-xs text-slate-600">Indiquer les quantités créditées ; les montants HT et la part de taxe seront calculés sur la facture d'origine. Les quantités déjà créditées sont contrôlées côté serveur.</p>
  {lines.map(l=><label key={l.id} className="flex flex-wrap items-center justify-between gap-2"><span>{l.deliveryLine.orderLine.product.name} · max {l.qty} {l.unit}</span><Input className="w-36" aria-label={`Quantité à créditer ligne ${l.id}`} placeholder="Qté à créditer" inputMode="decimal" value={quantities[l.id]??""} onChange={e=>setQuantities(old=>({...old,[l.id]:e.target.value}))}/></label>)}
  <label className="block">Motif de l'avoir (obligatoire)<Input maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motif détaillé"/></label>
  <Button size="sm" disabled={busy||!valid} onClick={submit}>Soumettre l'avoir détaillé pour approbation</Button>
 </div>
}
