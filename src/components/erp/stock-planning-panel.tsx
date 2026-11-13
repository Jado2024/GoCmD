'use client'
import {useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {toast} from 'sonner'
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {api} from './hooks'
import {hasRole,hasPermission,type SessionActor} from '@/lib/role-navigation'

type Suggestion={kind:'product'|'material';id:number;ref:string;name:string;unit:string;stockTracking:'active'|'not_connected'|'invalid';procurementType?:'ACHAT'|'FABRICATION';freeQty?:number;projectedQty?:number;minStock?:number;targetStock?:number;suggestedQty?:number;triggered?:boolean;openRequest?:string|null;reason?:string}
type Request={id:number;ref:string;qty:number;unit:string;status:string;createdBy:string;stockOrder?:{id:number;ref:string;status:string}|null}
export function StockPlanningPanel(){
 const qc=useQueryClient()
 const session=useQuery({queryKey:['me'],queryFn:()=>api<SessionActor>('/api/me')})
 const canPropose=(hasRole(session.data,'buyer')&&hasPermission(session.data,'purchases.create'))||(hasRole(session.data,'inventory')&&hasPermission(session.data,'stock.move'))||(hasRole(session.data,'production')&&hasPermission(session.data,'production.propose'))
 const canDecide=hasRole(session.data,'production')&&hasPermission(session.data,'production.approve')
 const canClose=hasRole(session.data,'production')&&hasPermission(session.data,'production.close')
 const canPlan=hasRole(session.data,'production')&&hasPermission(session.data,'production.plan')
 const canStart=hasRole(session.data,'production')&&hasPermission(session.data,'production.start')
 const canFinish=hasRole(session.data,'production')&&hasPermission(session.data,'production.finish')
 const [reason,setReason]=useState('Reconstitution du stock cible SODEPI')
 const [kindFilter,setKindFilter]=useState<'all'|'product'|'material'>('all')
 const [busy,setBusy]=useState(false)
 const plans=useQuery({queryKey:['stock-planning'],queryFn:()=>api<{items:Suggestion[],requests:Request[]}>('/api/stock-planning'),staleTime:15000})
 async function act(body:unknown){
  setBusy(true)
  try{await api('/api/stock-planning',{method:'POST',body:JSON.stringify(body)});toast.success('Planification mise à jour');await qc.invalidateQueries({queryKey:['stock-planning']})}
  catch(e){toast.error(e instanceof Error?e.message:'Validation refusée')}finally{setBusy(false)}
 }
 async function changeOrder(orderId:number,action:'plan'|'start'|'finish',ref:string){
  setBusy(true)
  try{await api('/api/production-stock',{method:'POST',body:JSON.stringify({orderId,action,reason:`${reason.trim()} - ${ref}`})});toast.success('OF MTS mis à jour');await qc.invalidateQueries({queryKey:['stock-planning']})}
  catch(e){toast.error(e instanceof Error?e.message:'Transition OF refusee')}finally{setBusy(false)}
 }
 const triggered=(plans.data?.items??[]).filter(x=>(kindFilter==='all'||x.kind===kindFilter)&&(x.triggered || x.openRequest)).sort((a,b)=>Number(b.kind==='product')-Number(a.kind==='product'))
 const untracked=(plans.data?.items??[]).filter(x=>(kindFilter==='all'||x.kind===kindFilter)&&x.stockTracking==='not_connected')
 return <Card className="border-slate-200">
  <CardHeader><CardTitle className="text-base">Planification des stocks — minimum / cible</CardTitle></CardHeader>
  <CardContent className="space-y-3">
   <p className="text-xs text-slate-600">Position = stock physique − réservations − commandes non réservées + arrivages fermes. Les alertes ne lancent aucune fabrication. Un OF-MTS unique est créé après validation nominative de la DPR.</p>
   <div className="flex gap-2 flex-wrap" role="group" aria-label="Famille de planification">
    {(['all','product','material'] as const).map(kind=><Button key={kind} variant={kindFilter===kind?'default':'outline'} size="sm" onClick={()=>setKindFilter(kind)}>{kind==='all'?'Tous les articles':kind==='product'?'Produits fabriqués':'Matières'}</Button>)}
   </div>
   <Input aria-label="Motif de planification" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motif de l'opération"/>
   {plans.isLoading&&<p className="text-xs">Calcul des besoins…</p>}
   {plans.isError&&<p className="text-xs text-rose-700">Planification indisponible</p>}
   {triggered.slice(0,60).map(x=><div key={`${x.kind}-${x.id}`} className="rounded-md border p-3 text-xs flex flex-wrap items-center justify-between gap-2">
     <div><strong>{x.ref} · {x.name}</strong><p className="text-slate-600">{x.procurementType} · position : {x.projectedQty?.toLocaleString('fr-FR')??'—'} {x.unit} · minimum {x.minStock} · cible {x.targetStock} · proposition : {x.suggestedQty} {x.unit}</p>
     {x.openRequest&&<p className="font-medium text-amber-700">Demande déjà ouverte : {x.openRequest}</p>}</div>
     {x.procurementType==='FABRICATION'&&x.stockTracking==='active'&&x.triggered&&!x.openRequest&&<Button size="sm" variant="outline" disabled={!canPropose||busy||reason.trim().length<10} onClick={()=>void act({action:'propose',kind:x.kind,id:x.id,reason})}>Proposer fabrication</Button>}
     {x.procurementType==='ACHAT'&&<span className="text-slate-500">DA : circuit achats existant (contrôle des doublons)</span>}
   </div>)}
   {!plans.isLoading&&triggered.length===0&&<p className="text-xs text-emerald-800">Aucune nouvelle alerte de reconstitution dans les articles suivis.</p>}
   {triggered.length>60&&<p className="text-xs">{triggered.length-60} autres alertes. Affiner le périmètre dans les fiches article.</p>}
   {untracked.length>0&&<p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">{untracked.length} produits avec seuil configuré mais stock physique non connecté aux lots et aux BL : aucune fausse proposition calculée. Raccordement nécessaire avant activation.</p>}
   {(plans.data?.requests??[]).filter(r=>r.status==='proposed'||r.status==='approved').map(r=><div key={r.id} className="rounded border p-2 text-xs flex flex-wrap justify-between items-center gap-2"><span>{r.ref} : {r.qty} {r.unit} · proposé par {r.createdBy}</span>
     {r.status==='proposed'&&canDecide&&<div className="flex gap-2"><Button size="sm" disabled={busy||reason.trim().length<10} onClick={()=>void act({action:'approve',requestId:r.id,reason})}>Valider</Button><Button size="sm" variant="outline" disabled={busy||reason.trim().length<10} onClick={()=>void act({action:'reject',requestId:r.id,reason})}>Refuser</Button></div>}
     {r.status==='approved'&&<div className="flex gap-2"><span className="text-amber-800">OF {r.stockOrder?.ref??"—"} : {r.stockOrder?.status??"non créé"} · Réceptions : référence {r.ref}</span>{canClose&&r.stockOrder?.status==='completed'&&<Button size="sm" variant="outline" disabled={busy||reason.trim().length<10} onClick={()=>void act({action:'complete',requestId:r.id,reason})}>Clôturer après libération qualité</Button>}{r.stockOrder?.status==='approved'&&canPlan&&<Button size="sm" disabled={busy||reason.trim().length<10} onClick={()=>void changeOrder(r.stockOrder!.id,'plan',r.ref)}>Planifier</Button>}{r.stockOrder?.status==='planned'&&canStart&&<Button size="sm" disabled={busy||reason.trim().length<10} onClick={()=>void changeOrder(r.stockOrder!.id,'start',r.ref)}>Lancer</Button>}{r.stockOrder?.status==='in_progress'&&canFinish&&<Button size="sm" disabled={busy||reason.trim().length<10} onClick={()=>void changeOrder(r.stockOrder!.id,'finish',r.ref)}>Terminer fabrication</Button>}{canDecide&&<Button size="sm" variant="outline" disabled={busy||reason.trim().length<10} onClick={()=>void act({action:'cancel',requestId:r.id,reason})}>Annuler</Button>}</div>}
   </div>)}
  </CardContent>
 </Card>
}
