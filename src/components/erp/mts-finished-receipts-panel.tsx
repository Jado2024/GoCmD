'use client'
import {useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {toast} from 'sonner'
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {api} from './hooks'
import {hasRole,hasPermission,type SessionActor} from '@/lib/role-navigation'
export function MtsFinishedReceiptsPanel(){
 const qc=useQueryClient()
 const {data:actor}=useQuery({queryKey:['me'],queryFn:()=>api<SessionActor>('/api/me')})
 const canReceive=hasRole(actor,'inventory')&&hasPermission(actor,'stock.move')
 const planning=useQuery({queryKey:['mts-finished-candidates'],queryFn:()=>api<{requests:Array<{ref:string;productId:number|null;status:string;qty:number;unit:string;stockOrder?:{status:string}|null}>}>('/api/stock-planning?take=200'),enabled:canReceive})
 const [product,setProduct]=useState(''),[source,setSource]=useState(''),[qty,setQty]=useState(''),[lot,setLot]=useState(''),[busy,setBusy]=useState(false)
 const [search,setSearch]=useState(''),[replacement,setReplacement]=useState(''),[reworkReason,setReworkReason]=useState('Remplacement du lot fini rejete apres controle qualite')
 const reworks=useQuery({queryKey:['mts-rework'],queryFn:()=>api<{approvals:Array<{id:number;sourceKind:string;sourceId:number;qty:number;usedQty:number}>}>('/api/production-stock/rework'),enabled:canReceive})
 const rejected=useQuery({queryKey:['finished-rejected',product],queryFn:()=>api<{items:Array<{id:number;status:string;sourceRef:string;lotCode:string}>}>('/api/sales/finished-stock?productId='+product),enabled:canReceive&&Number(product)>0})
 if(!canReceive)return null
 async function receive(){setBusy(true);try{
  await api('/api/sales/finished-stock',{method:'POST',body:JSON.stringify({action:'receive',productId:Number(product),sourceRef:source.trim(),qty:Number(qty),lotCode:lot.trim(),...(replacement?{replacementLotId:Number(replacement),reworkApprovalId:(reworks.data?.approvals??[]).find(x=>x.sourceKind==='finished_lot'&&x.sourceId===Number(replacement))?.id,replacementReason:reworkReason.trim()}:{})})})
  toast.success('Produit fini reçu en quarantaine, libération qualité requise')
  await qc.invalidateQueries({queryKey:['stock-planning']});await qc.invalidateQueries({queryKey:['finished-quality']})
 }catch(e){toast.error(e instanceof Error?e.message:'Reception refusee')}finally{setBusy(false)}}
 return <Card><CardHeader><CardTitle className="text-base">Réception produits finis — OF pour stock</CardTitle></CardHeader><CardContent className="space-y-2 text-xs">
 <p className="text-slate-600">Uniquement un OF-MTS terminé lié à une DPR produit. Les quantités acceptées ou en quarantaine plafonnent l'OF ; une unité rejetée peut être refabriquée avec référence et justification, sans effacer l'historique.</p>
 <div className="flex flex-wrap items-center gap-2">
 <Input aria-label="Rechercher DPR" className="w-40" placeholder="Rechercher DPR" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Selectionner une DPR produit" className="h-9 rounded-md border px-2" value={source} onChange={e=>{const v=(planning.data?.requests??[]).find(r=>r.ref===e.target.value);setSource(e.target.value);setProduct(v?.productId?String(v.productId):'');setReplacement('')}}><option value="">Sélectionner DPR validée</option>{(planning.data?.requests??[]).filter(r=>r.productId&&r.status==='approved'&&r.unit==='u'&&r.stockOrder?.status==='completed'&&r.ref.toLowerCase().includes(search.toLowerCase())).map(r=><option key={r.ref} value={r.ref}>{r.ref} · produit #{r.productId} · {r.qty} u</option>)}</select>
 <Input aria-label="Code lot produit fini" className="w-40" placeholder="Code lot" value={lot} onChange={e=>setLot(e.target.value)}/>
 <Input aria-label="Quantité entière produite" className="w-24" type="number" min="1" step="1" placeholder="Quantité" value={qty} onChange={e=>setQty(e.target.value)}/>
 <select aria-label="Lot fini rejete a remplacer" className="h-9 rounded-md border px-2" value={replacement} onChange={e=>setReplacement(e.target.value)}><option value="">Nouvelle fabrication normale</option>{(rejected.data?.items??[]).filter(r=>r.status==='rejected'&&r.sourceRef===source&&(reworks.data?.approvals??[]).some(a=>a.sourceKind==='finished_lot'&&a.sourceId===r.id&&a.usedQty<a.qty)).map(r=><option key={r.id} value={r.id}>{r.lotCode} · rejeté</option>)}</select>{replacement&&<Input aria-label="Motif de remplacement" className="w-60" maxLength={500} value={reworkReason} onChange={e=>setReworkReason(e.target.value)}/>}<Button size="sm" disabled={busy||(replacement!==''&&reworkReason.trim().length<10)||!Number.isSafeInteger(Number(product))||Number(product)<1||!/^DPR-[A-Z0-9-]+$/.test(source.trim())||lot.trim().length<3||!Number.isSafeInteger(Number(qty))||Number(qty)<1} onClick={()=>void receive()}>Réceptionner en quarantaine</Button>
 </div></CardContent></Card>
}
