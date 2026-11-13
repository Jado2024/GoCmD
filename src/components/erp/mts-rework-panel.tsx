'use client'
import {useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {toast} from 'sonner'
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {api} from './hooks'
import {hasRole,hasPermission,type SessionActor} from '@/lib/role-navigation'
type Source={kind:'material_receipt'|'finished_lot';id:number;qty:number;unit:string;productionRef:string;receivedBy:string;decidedBy:string|null}
type Approval={id:number;sourceKind:string;sourceId:number;approvedBy:string;qty:number;usedQty:number}
export function MtsReworkPanel(){
 const qc=useQueryClient()
 const session=useQuery({queryKey:['me'],queryFn:()=>api<SessionActor>('/api/me')})
 const canApprove=hasRole(session.data,'production')&&hasPermission(session.data,'production.approve')
 const {data,isLoading}=useQuery({queryKey:['mts-rework'],queryFn:()=>api<{sources:Source[];approvals:Approval[]}>('/api/production-stock/rework'),enabled:canApprove})
 const [reason,setReason]=useState('Reprise de fabrication autorisee apres non-conformite qualite'),[busy,setBusy]=useState(false)
 if(!canApprove)return null
 async function approve(source:Source){setBusy(true);try{
  await api('/api/production-stock/rework',{method:'POST',body:JSON.stringify({sourceKind:source.kind,sourceId:source.id,reason:reason.trim()})})
  toast.success('OF de reprise REOF autorisé et historisé')
  await qc.invalidateQueries({queryKey:['mts-rework']})
 }catch(e){toast.error(e instanceof Error?e.message:'Approbation refusée')}finally{setBusy(false)}}
 const eligible=(data?.sources??[]).filter(s=>!data?.approvals.some(a=>a.sourceKind===s.kind&&a.sourceId===s.id))
 return <Card><CardHeader><CardTitle className="text-base">Reprises de fabrication — rejets qualité</CardTitle></CardHeader><CardContent className="space-y-2 text-xs">
 <p className="text-slate-600">Une unité rejetée doit avoir un OF de reprise (REOF) autorisé par la production avant une nouvelle réception. Le contrôle qualité, le magasin et le responsable sont distincts. Les historiques restent immuables.</p>
 <Input aria-label="Justification de la reprise" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/>
 {isLoading&&<p>Recherche des lots rejetés…</p>}
 {eligible.map(s=><div key={`${s.kind}-${s.id}`} className="rounded border p-2 flex flex-wrap items-center justify-between gap-2"><span><strong>{s.productionRef}</strong> · {s.kind==='material_receipt'?'Matière':'Produit fini'} · rejet #{s.id} · {s.qty} {s.unit}</span><Button size="sm" disabled={busy||reason.trim().length<10||session.data?.username===s.receivedBy||session.data?.username===s.decidedBy} onClick={()=>void approve(s)}>Autoriser reprise</Button></div>)}
 {!isLoading&&!eligible.length&&<p className="text-slate-500">Aucun rejet en attente d'autorisation.</p>}
 </CardContent></Card>
}
