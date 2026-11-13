'use client'
import {useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {toast} from 'sonner'
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {api} from './hooks'
import {hasRole,hasPermission,type SessionActor} from '@/lib/role-navigation'
type CostOrder={id:number;ref:string;status:string;request:{ref:string;qty:number;unit:string;createdBy:string;material?:{ref:string;name:string}|null};approvedMaterialCost?:{unitCost:string;currency:string;approvedBy:string}|null}
export function MtsMaterialCostPanel(){
 const qc=useQueryClient()
 const session=useQuery({queryKey:['me'],queryFn:()=>api<SessionActor>('/api/me')})
 const finance=hasRole(session.data,'finance')&&hasPermission(session.data,'finance.purchases')
 const {data,isError}=useQuery({queryKey:['mts-material-cost'],queryFn:()=>api<{items:CostOrder[]}>('/api/production-stock/cost'),enabled:finance})
 const [selected,setSelected]=useState(''),[search,setSearch]=useState(''),[cost,setCost]=useState(''),[reason,setReason]=useState('Valorisation provisoire au cout standard valide par la finance'),[busy,setBusy]=useState(false)
 if(!finance)return null
 async function approve(){setBusy(true);try{
  await api('/api/production-stock/cost',{method:'POST',body:JSON.stringify({stockOrderId:Number(selected),unitCost:Number(cost),reason:reason.trim()})})
  toast.success('Coût standard MAD approuvé et journalisé')
  await qc.invalidateQueries({queryKey:['mts-material-cost']});await qc.invalidateQueries({queryKey:['mts-receipts']})
 }catch(e){toast.error(e instanceof Error?e.message:'Coût refusé')}finally{setBusy(false)}}
 const available=(data?.items??[]).filter(x=>!x.approvedMaterialCost&&x.status!=='closed'&&x.status!=='cancelled'&&x.request.createdBy!==session.data?.username&&`${x.ref} ${x.request.material?.name??''}`.toLowerCase().includes(search.toLowerCase()))
 return <Card><CardHeader><CardTitle className="text-base">Finance — coût standard provisoire des fabrications MTS</CardTitle></CardHeader><CardContent className="space-y-2 text-xs">
 <p className="text-slate-600">La finance valide un coût de fabrication en MAD avant la première libération qualité. Il ne s'agit pas d'un coût réel détaillé : GoProd devra calculer la consommation et les temps machines. Un coût approuvé ne peut pas être modifié silencieusement.</p>
 {isError&&<p className="text-rose-700">Données de coûts indisponibles</p>}
 <div className="flex flex-wrap items-center gap-2">
  <Input aria-label="Recherche OF fabricant" className="w-40" placeholder="Chercher un OF" value={search} onChange={e=>setSearch(e.target.value)}/>
  <select aria-label="OF pour validation du coût" className="h-9 rounded-md border px-2" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Sélectionner OF</option>{available.map(x=><option key={x.id} value={x.id}>{x.ref} · {x.request.material?.ref??'matière'} · {x.request.qty} {x.request.unit}</option>)}</select>
  <Input aria-label="Cout de fabrication MAD par unite" type="number" min="0.000001" step="0.000001" className="w-36" value={cost} onChange={e=>setCost(e.target.value)} placeholder="MAD/unité"/>
  <Input aria-label="Justificatif du cout standard" className="w-64" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/>
  <Button size="sm" disabled={busy||!selected||!Number.isFinite(Number(cost))||Number(cost)<=0||reason.trim().length<10} onClick={()=>void approve()}>Valider le coût</Button>
 </div></CardContent></Card>
}
