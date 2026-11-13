'use client'
import {useEffect,useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {toast} from 'sonner'
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {api} from './hooks'
import type {MaterialDTO} from '@/lib/erp-types'
export function MaterialsPriceReview(){
 const qc=useQueryClient(),[reason,setReason]=useState('Décision tarifaire directeur SODEPI'),[busy,setBusy]=useState<number|null>(null)
 const [page,setPage]=useState(1),[search,setSearch]=useState('')
 const materials=useQuery({queryKey:['material-sales-prices-review',page,search],queryFn:()=>api<{items:MaterialDTO[];total:number;pages:number;page:number}>(`/api/materials/price-proposals?${new URLSearchParams({page:String(page),pageSize:'40',q:search})}`),refetchInterval:30000})
 useEffect(()=>{const max=materials.data?.pages;if(max&&page>max)setPage(max)},[materials.data?.pages,page])
 const pending=materials.data?.items??[]
 async function decide(m:MaterialDTO,action:'approve'|'reject'){
  setBusy(m.id)
  try{await api(`/api/materials/${m.id}/sales-price`,{method:'POST',body:JSON.stringify({action,revision:m.salesPriceProposalRevision??0,reason})});toast.success(action==='approve'?'Prix catalogue approuvé':'Proposition refusée');await qc.invalidateQueries({queryKey:['material-sales-prices-review']});await qc.invalidateQueries({queryKey:['materials']});await qc.invalidateQueries({queryKey:['products']})}
  catch(e){toast.error(e instanceof Error?e.message:'Décision refusée')}finally{setBusy(null)}
 }
 return <Card className="border-violet-200"><CardHeader><CardTitle className="text-base">Direction — propositions tarifaires des matières revendues</CardTitle></CardHeader><CardContent className="space-y-2">
  <Input aria-label="Motif de décision tarifaire" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/>
  <Input type="search" aria-label="Rechercher toutes les propositions (référence, matière)" placeholder="Rechercher référence ou matière…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/>
  <div className="flex flex-wrap items-center justify-between gap-2 text-xs" aria-live="polite"><span>{materials.data?.total??0} proposition(s) en attente · page {materials.data?.page??page}/{materials.data?.pages??1}</span>
    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Précédent</Button><Button size="sm" variant="outline" disabled={page>=(materials.data?.pages??1)} onClick={()=>setPage(p=>p+1)}>Suivant</Button></div></div>
  {materials.isError&&<p className="text-xs text-rose-700">Liste des propositions indisponible.</p>}
  {pending.map(m=><div key={m.id} className="flex flex-wrap justify-between gap-2 rounded border p-2 text-xs"><span>{m.ref} · {m.name}: {m.salesUnitPrice} → {m.pendingSalesUnitPrice} MAD/{m.salesUnit} · proposé par {m.salesPriceProposedBy}</span><div className="flex gap-2"><Button size="sm" disabled={busy===m.id||reason.trim().length<10} onClick={()=>void decide(m,'approve')}>Valider</Button><Button size="sm" variant="outline" disabled={busy===m.id||reason.trim().length<10} onClick={()=>void decide(m,'reject')}>Refuser</Button></div></div>)}
  {!materials.data?.total&&!materials.isLoading&&!materials.isError&&<p className="text-xs">Aucune proposition en attente.</p>}
 </CardContent></Card>
}
