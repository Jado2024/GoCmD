'use client'
import {useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {toast} from 'sonner'
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {api} from './hooks'
type QualityLot={id:number;lotCode:string;qty:number;sourceRef:string;receivedBy:string;product:{name:string;sku:string;unit:string}}
export function FinishedQualityPanel(){
 const qc=useQueryClient(),[busy,setBusy]=useState<number|null>(null),[reason,setReason]=useState('Contrôle qualité atelier conforme')
 const lots=useQuery({queryKey:['finished-quality'],queryFn:()=>api<{items:QualityLot[]}>('/api/sales/finished-stock?pending=1'),refetchInterval:30000})
 async function decide(id:number,action:'release'|'reject'){
  setBusy(id)
  try {await api('/api/sales/finished-stock',{method:'POST',body:JSON.stringify({action,lotId:id,reason:reason.trim()})});toast.success(action==='release'?'Lot libéré et disponible':'Lot refusé');await qc.invalidateQueries({queryKey:['finished-quality']})}
  catch(e){toast.error(e instanceof Error?e.message:'Décision refusée')}finally{setBusy(null)}
 }
 return <Card className="border-amber-200"><CardHeader><CardTitle className="text-base">Contrôle qualité — produits finis reçus</CardTitle></CardHeader><CardContent className="space-y-2">
  <p className="text-xs text-slate-600">Un lot reçu depuis un OF reste bloqué jusqu'au visa d'un autre utilisateur qualité. Le fabricant et la personne qualité sont distincts.</p>
  <Input aria-label="Motif de décision qualité" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} />
  {lots.isLoading&&<p className="text-xs">Chargement…</p>}
  {lots.isError&&<p className="text-xs text-rose-700">Lots finis indisponibles.</p>}
  {(lots.data?.items??[]).map(l=><div key={l.id} className="flex flex-wrap items-center justify-between gap-2 border rounded p-2 text-xs"><span>{l.product.sku} · {l.product.name} · lot {l.lotCode} · {l.qty} {l.product.unit} · {l.sourceRef}</span><div className="flex gap-2"><Button size="sm" disabled={busy===l.id||reason.trim().length<10} onClick={()=>void decide(l.id,'release')}>Libérer</Button><Button size="sm" variant="outline" disabled={busy===l.id||reason.trim().length<10} onClick={()=>void decide(l.id,'reject')}>Refuser</Button></div></div>)}
  {!lots.isLoading&&!lots.isError&&!lots.data?.items.length&&<p className="text-xs">Aucun lot en attente.</p>}
 </CardContent></Card>
}
