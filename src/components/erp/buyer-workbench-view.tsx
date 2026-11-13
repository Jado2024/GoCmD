"use client";

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Factory, RefreshCw, ShoppingCart, Truck, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { MaterialDTO } from '@/lib/erp-types'
import type { BuyerStage, BuyerTask, BuyerCounts } from '@/lib/buyer-workbench'
import { fmtNum } from '@/lib/erp-types'
import { api } from './hooks'
import type { ViewId } from './nav-sidebar'

type BuyerPayload={
  counts:BuyerCounts;tasks:BuyerTask[];
  workflow:{waitingApprovals:number;preparedConsultations:number;openRfqs:number;openSupplierOrders:number};
  note:string
}
type Filter='all'|'buy'|'suppliers'|'approval'|'sourcing'|'receipt'|'production'
const STAGES:Record<BuyerStage,string>={
  create_da:'Créer une DA',supplier_missing:'Fournisseur à référencer',awaiting_approval:'Validation attendue',
  awaiting_sourcing:'Consultation / BC',awaiting_receipt:'Réception à suivre',manufacturing:'Besoin fabrication',not_purchasable:'Classification à contrôler',
}

export function BuyerWorkbenchView({onGoTo,onOpenPurchase}:{
  onGoTo:(v:ViewId)=>void;onOpenPurchase:(m:MaterialDTO)=>void
}){
  const result=useQuery({queryKey:['buyer-workbench'],queryFn:()=>api<BuyerPayload>('/api/p2p/buyer-workbench'),staleTime:10_000})
  const [filter,setFilter]=useState<Filter>('all')
  const [search,setSearch]=useState('')
  const [opening,setOpening]=useState<number|null>(null)
  const tasks=useMemo(()=>{
    const query=search.trim().toLocaleLowerCase('fr')
    return (result.data?.tasks??[]).filter(row=>{
      const matching= !query||`${row.ref} ${row.name} ${row.category}`.toLocaleLowerCase('fr').includes(query)
      if(!matching)return false
      if(filter==='buy')return row.stage==='create_da'||row.stage==='not_purchasable'
      if(filter==='suppliers')return row.stage==='supplier_missing'
      if(filter==='approval')return row.stage==='awaiting_approval'
      if(filter==='sourcing')return row.stage==='awaiting_sourcing'
      if(filter==='receipt')return row.stage==='awaiting_receipt'
      if(filter==='production')return row.stage==='manufacturing'
      return true
    })
  },[filter,search,result.data?.tasks])
  const counts=result.data?.counts
  async function createFromItem(id:number){
    if(opening!==null)return
    setOpening(id)
    try{
      // On utilise le DTO matière autorisé par le serveur, et le dialogue métier
      // existant : pas de création automatique ni de contournement du contrôle DA.
      const materials=await api<{items:MaterialDTO[]}>(`/api/materials?id=${id}`)
      const selected=materials.items.find(m=>m.id===id)
      if(!selected || !selected.isPurchasable || selected.foamNature==='AGGLO')throw Error('Matière non disponible pour une demande d’achat')
      onOpenPurchase(selected)
    }catch(e){toast.error(e instanceof Error?e.message:'Impossible d’ouvrir la demande')}
    finally{setOpening(null)}
  }
  if(result.isPending)return <div role="status" className="rounded-xl border bg-white p-6 text-sm text-slate-600">Chargement des tâches achats…</div>
  if(result.isError)return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
    Impossible de consulter le poste de travail acheteur. Vérifiez votre session et les accès.
    <Button className="ml-3" variant="outline" size="sm" onClick={()=>void result.refetch()}>Réessayer</Button>
  </div>
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div>
        <p className="font-semibold text-slate-900">Mes actions achats</p>
        <p className="text-xs text-slate-600">Besoins calculés depuis les stocks et documents ouverts ; aucune DA créée automatiquement.</p>
      </div>
      <Button variant="outline" size="sm" disabled={result.isFetching} onClick={()=>void result.refetch()}>
        <RefreshCw className="mr-2 size-4" aria-hidden/> {result.isFetching?'Actualisation…':'Actualiser'}
      </Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Synthèse achats">
      <Card className="border-rose-200"><CardHeader className="pb-1"><CardDescription>Ruptures à acheter</CardDescription><CardTitle className="text-3xl text-rose-800">{counts!.toBuyOut}</CardTitle></CardHeader><CardContent className="text-xs text-slate-600">Sans DA ouverte ; action prioritaire</CardContent></Card>
      <Card><CardHeader className="pb-1"><CardDescription>Stocks faibles à examiner</CardDescription><CardTitle className="text-3xl">{counts!.toBuyLow}</CardTitle></CardHeader><CardContent className="text-xs text-slate-600">Matières achetables sans DA ouverte</CardContent></Card>
      <Card><CardHeader className="pb-1"><CardDescription>DA en attente de validation</CardDescription><CardTitle className="text-3xl">{result.data.workflow.waitingApprovals}</CardTitle></CardHeader><CardContent className="text-xs text-slate-600">Décision par un approbateur distinct</CardContent></Card>
      <Card><CardHeader className="pb-1"><CardDescription>Besoins de fabrication</CardDescription><CardTitle className="text-3xl">{counts!.manufacturing}</CardTitle></CardHeader><CardContent className="text-xs text-slate-600">Information atelier, hors achat fournisseur</CardContent></Card>
    </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Étapes des dossiers achats">
      <WorkflowCard icon={ClipboardCheck} title="En attente de validation" value={result.data.workflow.waitingApprovals} desc="À décider par un approbateur distinct, pas par l’acheteur" onClick={()=>onGoTo('purchases')}/>
      <WorkflowCard icon={Users} title="En attente des fournisseurs" value={result.data.workflow.preparedConsultations} desc={`${result.data.workflow.openRfqs} RFQ ouvertes · dossiers préparés, envoi non automatique`} onClick={()=>onGoTo('p2p-advanced')}/>
      <WorkflowCard icon={Truck} title="En attente de réception" value={result.data.workflow.openSupplierOrders} desc="BC confirmés ou partiellement reçus" onClick={()=>onGoTo('supplier-orders')}/>
      <WorkflowCard icon={Factory} title="À transmettre à la production" value={counts!.manufacturing} desc="À signaler à l'atelier, sans ordre de fabrication automatique" onClick={()=>{setFilter('production');setSearch('')}}/>
    </div>
    {(counts!.needSupplier>0||counts!.blocked>0)&&<div role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <AlertTriangle className="mr-2 inline size-4" aria-hidden/>
      {counts!.needSupplier} matière(s) achetable(s) sans fournisseur actif et {counts!.blocked} article(s) non achetable(s) à classifier. Aucun achat automatique n'est proposé pour ces cas.
    </div>}
    <Card className="border-slate-200">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle className="text-base">Liste de travail priorisée</CardTitle><CardDescription>Ruptures en premier, puis suivis et fabrication</CardDescription></div>
          <Button variant="outline" size="sm" onClick={()=>onGoTo('purchases')}><ShoppingCart className="mr-2 size-4"/>Toutes les DA</Button>
        </div>
        <Input aria-label="Rechercher une matière dans les tâches" placeholder="Rechercher par référence, matière ou catégorie…" value={search} onChange={e=>setSearch(e.target.value)} />
        <div className="flex flex-wrap gap-2" aria-label="Filtres des tâches">
          {([['all','Toutes'],['buy','Préparer DA'],['suppliers','Fournisseurs manquants'],['approval','Approbation'],['sourcing','Consultations'],['receipt','Réceptions'],['production','Fabrication']] as const).map(([key,label])=><Button key={key} size="sm" variant={filter===key?'default':'outline'} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</Button>)}
        </div>
      </CardHeader>
      <CardContent>
        {tasks.length===0?<div role="status" className="rounded-lg bg-slate-50 p-5 text-sm text-slate-600">Aucune tâche dans ce filtre.</div>:<div className="max-h-[680px] space-y-2 overflow-y-auto pr-1">
          {tasks.map(item=><div key={item.materialId} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {item.severity==='rupture'?<span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">Rupture</span>:<span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Stock faible</span>}
                <span className="text-xs text-slate-600">{STAGES[item.stage]}</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-900">{item.name} <span className="font-normal text-slate-500">· {item.ref}</span></p>
              <p className="text-xs text-slate-700">Stock {fmtNum(item.stockQty)} / min. {fmtNum(item.minStock)} {item.unit} · besoin théorique {fmtNum(item.suggestedQty)} {item.unit}</p>
              <p className="mt-1 text-xs text-slate-600">{item.reason}{item.requestRefs.length?` · DA : ${item.requestRefs.join(', ')}`:''}{item.inboundQty>0?` · ${fmtNum(item.inboundQty)} ${item.unit} attendus`:''}</p>
            </div>
            {item.stage==='create_da'?<Button size="sm" disabled={opening!==null} onClick={()=>void createFromItem(item.materialId)}><ShoppingCart className="mr-1 size-4"/>{opening===item.materialId?'Ouverture…':'Préparer DA'}</Button>:
            item.stage==='supplier_missing'?<Button size="sm" variant="outline" onClick={()=>onGoTo('suppliers')}>Voir fournisseurs <ArrowRight className="ml-1 size-4"/></Button>:
            item.stage==='manufacturing'?<Button size="sm" variant="outline" onClick={()=>onGoTo('materials')}>Voir matière <ArrowRight className="ml-1 size-4"/></Button>:
            item.stage==='awaiting_receipt'?<Button size="sm" variant="outline" onClick={()=>onGoTo('supplier-orders')}>Suivre le BC <ArrowRight className="ml-1 size-4"/></Button>:
            item.stage==='awaiting_sourcing'?<Button size="sm" variant="outline" onClick={()=>onGoTo('p2p-advanced')}>Voir consultation <ArrowRight className="ml-1 size-4"/></Button>:
            <Button size="sm" variant="outline" onClick={()=>onGoTo(item.stage==='not_purchasable'?'materials':'purchases')}>Consulter <ArrowRight className="ml-1 size-4"/></Button>}
          </div>)}
        </div>}
        <p className="mt-3 text-xs text-slate-500">{tasks.length} affichée(s) sur {counts!.totalAlerts} alertes sous le seuil. Les quantités proposées n'incluent pas une prévision de consommation ; vérifiez les DA et réceptions en cours.</p>
      </CardContent>
    </Card>
    <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden/>
      La création d'une DA exige toujours une action de l'acheteur, puis l'approbation par un compte distinct. Les articles fabriqués en interne ne génèrent pas de commande fournisseur.
    </div>
  </div>
}

function WorkflowCard({icon:Icon,title,value,desc,onClick}:{icon:LucideIcon;title:string;value:number;desc:string;onClick:()=>void}){
  return <Card className="border-slate-200"><CardContent className="flex items-start gap-3 p-4"><Icon className="mt-1 size-5 shrink-0 text-slate-600" aria-hidden/><div className="min-w-0 flex-1">
    <p className="text-sm font-semibold text-slate-900">{title}</p><p className="text-2xl font-semibold tabular-nums">{value}</p><p className="min-h-8 text-xs text-slate-600">{desc}</p>
    <Button className="mt-2" size="sm" variant="outline" onClick={onClick}>Ouvrir <ArrowRight className="ml-1 size-4"/></Button>
  </div></CardContent></Card>
}
