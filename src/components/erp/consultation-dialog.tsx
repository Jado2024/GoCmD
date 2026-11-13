"use client";
import {useState} from 'react';
import {FileDown,Mail,Send,AlertTriangle,ExternalLink,RefreshCw} from 'lucide-react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {SearchableCombobox} from '@/components/ui/searchable-combobox';
import {Input} from '@/components/ui/input';
import {api} from './hooks';
import {isValidPurchaseQuantity} from '@/lib/purchase-quantity';
import {activeConsultations,canPrepareConsultation,type ConsultationHistory} from '@/lib/consultation-reuse';
import type {PurchaseDTO} from '@/lib/erp-types';

type Supplier={id:number;name:string;active:boolean;email:string|null;materials:{materialId:number}[]};
import {DocumentPager} from "./document-pager";
import {useDocumentRegister} from "./use-document-register";
import {MATERIAL_CATEGORIES} from "@/lib/material-reference";
type SelectedLine=PurchaseDTO['lines'][number]&{requestRef:string};
const remaining=(line:SelectedLine|PurchaseDTO['lines'][number])=>line.consultationRemainingQty??0;
type Created={id:number;ref:string};
function mailto(email:string,ref:string){
 const subject=`SODEPI - Demande de prix ${ref}`;
 const body=`Bonjour,\n\nVeuillez trouver ci-joint notre demande de prix ${ref}. Merci de nous préciser vos tarifs, délais de livraison et conditions.\n\nCordialement,\nService achats SODEPI`;
 return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
/** Une consultation peut réunir plusieurs DA et plusieurs fournisseurs, avec le rattachement des lignes préservé. */
export function ConsultationDialog({purchase,onClose}:{purchase?:PurchaseDTO;onClose:()=>void}){
 const qc=useQueryClient();
 const [selectedLines,setSelectedLines]=useState<SelectedLine[]>(()=>purchase?
  purchase.lines.filter(l=>remaining(l)>0).slice(0,50).map(l=>({...l,requestRef:purchase.ref})):[]);
 const [page,setPage]=useState(1);
 const [qtyDraft,setQtyDraft]=useState<Record<number,string>>({});
 const [suppliers,setSuppliers]=useState<Record<number,number[]>>({});
 const [search,setSearch]=useState('');
 const [family,setFamily]=useState('all');
 const [risk,setRisk]=useState('all');
 const [deadline,setDeadline]=useState('');
 const [error,setError]=useState('');
 const [openRfqs,setOpenRfqs]=useState<{ref:string;requestLineId:number}[]>([]);
 const [reconsultReason,setReconsultReason]=useState('');
 const [explicitReconsultKey,setExplicitReconsultKey]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [created,setCreated]=useState<Created|null>(null);
 const suppliersQ=useQuery({queryKey:['suppliers'],queryFn:()=>api<{items:Supplier[]}>('/api/suppliers')});
 const requests=useDocumentRegister<PurchaseDTO>('purchases',search,page,true,{eligible:'1',pageSize:'20',category:family,risk});
 const eligible=requests.data?.items??[];
 const lineIdsKey=selectedLines.map(l=>l.id).sort((a,b)=>a-b).join(',');
 const historyQ=useQuery({queryKey:['consultation-line-history',lineIdsKey],
  queryFn:()=>api<{items:ConsultationHistory[]}>(`/api/p2p/consultations/line-status?lineIds=${lineIdsKey}`),
  enabled:lineIdsKey.length>0,staleTime:0,refetchOnWindowFocus:true});
 const previous=historyQ.data?.items??[];
 const active=activeConsultations(previous);
 const needsReconsult=active.length>0||openRfqs.length>0;
 const explicitReconsult=explicitReconsultKey===lineIdsKey;
 const availableSuppliers=(suppliersQ.data?.items??[]).filter(s=>s.active&&selectedLines.some(l=>s.materials.some(m=>m.materialId===l.material.id)));
 const suppliersFor=(lineId:number,materialId:number)=>availableSuppliers
  .filter(s=>suppliers[lineId]?.includes(s.id)&&s.materials.some(m=>m.materialId===materialId)).map(s=>s.id);
 const chosenSuppliers=availableSuppliers.filter(s=>selectedLines.some(l=>suppliersFor(l.id,l.material.id).includes(s.id)));
 const uncovered=selectedLines.filter(l=>suppliersFor(l.id,l.material.id).length===0);
 const visibleLine=(l:PurchaseDTO['lines'][number])=>
  remaining(l)>0&&
  (family==='all'||family===l.material.category)&&
  (risk==='all'||(risk==='out'?l.material.stockQty<=0:l.material.stockQty>0&&l.material.stockQty<l.material.minStock));
 const quantityOf=(line:SelectedLine)=>qtyDraft[line.id]===undefined?remaining(line):Number(qtyDraft[line.id].replace(',','.'));
 const validLines=selectedLines.length>0&&selectedLines.length<=50&&selectedLines.every(l=>{
  const n=quantityOf(l),max=remaining(l);
  return isValidPurchaseQuantity(n,l.material.unit)&&n<=max+0.000001;
 });
 const canSubmit=(!needsReconsult||(explicitReconsult&&reconsultReason.trim().length>=10))&&
  canPrepareConsultation(previous,explicitReconsult,reconsultReason)&&validLines&&chosenSuppliers.length>0&&uncovered.length===0&&
  !busy&&historyQ.isSuccess&&!historyQ.isFetching&&Boolean(lineIdsKey);
 function toggleLine(line:SelectedLine,checked:boolean){
  setExplicitReconsultKey(null);setReconsultReason('');setOpenRfqs([]);
  setSelectedLines(old=>checked&&old.length<50?[...old.filter(l=>l.id!==line.id),line]:old.filter(l=>l.id!==line.id));
 }
 async function create(){
  if(!canSubmit)return;
  setError('');setBusy(true);
  try{
   const result=await api<{consultation:Created;mailSent:boolean}>('/api/p2p/consultations',{method:'POST',body:JSON.stringify({
    lines:selectedLines.map(l=>({requestLineId:l.id,qty:quantityOf(l),supplierIds:suppliersFor(l.id,l.material.id)})),supplierIds:chosenSuppliers.map(s=>s.id),
    ...(deadline?{deadline}:{}),...(needsReconsult&&explicitReconsult?{reconsultReason:reconsultReason.trim()}:{})
   })});
   setCreated(result.consultation);await Promise.all([qc.invalidateQueries({queryKey:['p2p-consultations']}),qc.invalidateQueries({queryKey:['consultation-line-history']})]);
  }catch(e){
   const detail=e as Error&{status?:number;body?:{code?:string;openRfqs?:{ref:string;requestLineId:number}[]}};
   if(detail.status===409&&detail.body?.code==='RFQ_DEJA_OUVERTE')setOpenRfqs(detail.body.openRfqs??[]);
   setError(detail instanceof Error?detail.message:'Enregistrement impossible');
  }finally{setBusy(false)}
 }
 return <Dialog open onOpenChange={open=>!open&&onClose()}><DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 sm:max-w-5xl">
  <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-6"><DialogTitle className="text-lg">Consultation multi-DA et multi-fournisseurs</DialogTitle>
   <DialogDescription>Sélectionnez plusieurs DA validées ; chaque ligne conserve son origine. Le PDF et l'email restent séparés par fournisseur.</DialogDescription>
  </DialogHeader>
  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
   {created?<section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
    <h3 className="font-semibold text-emerald-950">Dossier {created.ref} préparé</h3>
    <p className="text-sm text-emerald-900">Les PDF sont générés directement ; aucun email n'a été envoyé. Chaque fournisseur reçoit uniquement ses propres lignes.</p>
    {chosenSuppliers.map(s=><div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3">
     <div><strong className="text-sm">{s.name}</strong><p className="text-xs text-slate-500">{selectedLines.filter(l=>suppliersFor(l.id,l.material.id).includes(s.id)).length} ligne(s) · {s.email??'Email à renseigner'}</p></div>
     <div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><a href={`/api/p2p/consultations/${created.id}/pdf?supplierId=${s.id}`} target="_blank" rel="noopener noreferrer"><FileDown className="mr-1 size-4"/>Télécharger PDF</a></Button>
     {s.email?<Button asChild variant="outline" size="sm"><a href={mailto(s.email,created.ref)}><Mail className="mr-1 size-4"/>Préparer email</a></Button>:<span className="text-xs text-amber-700">Adresse email manquante</span>}</div>
    </div>)}
    <p className="text-xs text-slate-700">Joindre manuellement le PDF au message préparé. Aucun envoi automatique.</p>
   </section>:<>
    <section className="rounded-xl border bg-white p-3 sm:p-4"><h3 className="font-semibold">1. Choisir les demandes d'achat</h3>
     <p className="mb-3 text-xs text-slate-600">{selectedLines.length} / 50 lignes sélectionnées. La sélection est conservée quand vous changez de page ou de filtre.</p>
     <div className="mb-3 grid gap-2 sm:grid-cols-3">
      <Input aria-label="Rechercher une DA ou une matière" placeholder="Référence DA, code ou désignation" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/>
      <SearchableCombobox label="Famille" value={family} onChange={v=>{setFamily(v);setPage(1)}} options={[{value:'all',label:'Toutes les familles'},...MATERIAL_CATEGORIES.map(value=>({value,label:value}))]}/>
      <SearchableCombobox label="Risque" value={risk} onChange={v=>{setRisk(v);setPage(1)}} options={[{value:'all',label:'Tous les risques'},{value:'out',label:'En rupture'},{value:'low',label:'Sous le seuil'}]}/>
     </div>
     <div className="grid gap-2 sm:grid-cols-2">{eligible.map(p=>{const viable=p.lines.filter(l=>visibleLine(l));if(!viable.length)return null;
      return <fieldset key={p.id} className="rounded-lg border p-3 text-sm"><legend className="px-1 font-semibold">{p.ref}</legend>
       {viable.map(l=><label key={l.id} className="flex items-center gap-2 py-1"><input type="checkbox" className="size-6 shrink-0 accent-[#bd202a]" checked={selectedLines.some(x=>x.id===l.id)} disabled={selectedLines.length>=50&&!selectedLines.some(x=>x.id===l.id)} onChange={e=>toggleLine({...l,requestRef:p.ref},e.target.checked)}/><span>{l.material.name} · {remaining(l)} {l.material.unit}</span></label>)}
      </fieldset>})}</div>
     {requests.isPending&&<p role="status">Recherche des DA…</p>}
     {requests.isError&&<p role="alert">Impossible de charger les DA. <Button size="sm" variant="outline" onClick={()=>void requests.refetch()}>Réessayer</Button></p>}
     {requests.isSuccess&&!eligible.some(p=>p.lines.some(l=>visibleLine(l)))&&<p className="text-sm text-slate-500">Aucune ligne éligible pour ces filtres.</p>}
     <DocumentPager page={page} data={requests.data?.pagination} onPage={setPage} label="DA à consulter"/>
    </section>
    <div className="grid gap-4 lg:grid-cols-2">
     <section className="space-y-3 rounded-xl border bg-white p-3 sm:p-4"><h3 className="font-semibold">2. Matières et quantités</h3>
      {selectedLines.map(l=>{const max=remaining(l);const qty=quantityOf(l);const valid=isValidPurchaseQuantity(qty,l.material.unit)&&qty<=max+0.000001;
       return <div key={l.id} className="space-y-2 rounded-lg border p-3 text-sm">
        <div className="flex items-start justify-between gap-2"><span className="min-w-0"><strong className="block">{l.material.name}</strong><span className="block break-all text-xs text-slate-500">{l.requestRef} · {l.material.ref}</span></span>
         <button type="button" className="text-xs font-semibold text-rose-700 underline" onClick={()=>toggleLine(l,false)}>Retirer</button></div>
        <div className="flex items-center gap-2"><label className="flex-1 text-xs">Quantité à consulter ({l.material.unit})
         <Input type="number" min="0.001" max={max} step="any" className="mt-1 w-full" value={qtyDraft[l.id]??String(max)} onChange={e=>setQtyDraft(p=>({...p,[l.id]:e.target.value}))}/></label><span className="text-xs text-slate-500">Reste : {max}</span></div>
        {!valid&&<p className="text-xs text-rose-700">Quantité invalide ou supérieure au besoin restant ; respecter l'unité de stock.</p>}
       </div>})}
      {!selectedLines.length&&<p className="text-sm text-slate-500">Sélectionnez au moins une DA ci-dessus.</p>}
     </section>
     <section className="space-y-3 rounded-xl border bg-white p-3 sm:p-4"><h3 className="font-semibold">3. Fournisseurs destinataires</h3>
      {selectedLines.map(l=><fieldset key={l.id} className="rounded-lg border p-3 text-sm">
       <legend className="px-1 font-semibold">{l.requestRef} · {l.material.name}</legend>
       {availableSuppliers.filter(s=>s.materials.some(m=>m.materialId===l.material.id)).map(s=><label key={s.id} className="flex items-center gap-2 py-1">
        <input className="size-6 shrink-0 accent-[#bd202a]" type="checkbox" checked={suppliers[l.id]?.includes(s.id)??false} onChange={e=>{const checked=e.target.checked;setSuppliers(old=>({...old,[l.id]:checked?[...(old[l.id]??[]),s.id]:(old[l.id]??[]).filter(id=>id!==s.id)}))}}/>
        <span>{s.name} · <span className="text-xs text-slate-600">{s.email?'E-mail renseigné':'E-mail absent'}</span></span>
       </label>)}
      </fieldset>)}
      {uncovered.length>0&&<p className="rounded bg-amber-50 p-2 text-xs text-amber-900">Sans fournisseur sélectionné : {uncovered.map(l=>`${l.requestRef} / ${l.material.name}`).join(' · ')}</p>}
      {!availableSuppliers.length&&<p className="text-sm text-slate-600">Aucun fournisseur actif pour les matières sélectionnées.</p>}
     </section>
    </div>
    <section className="rounded-xl border bg-slate-50 p-3 sm:p-4"><h3 className="font-semibold">4. Préparation des documents</h3>
     <p className="text-xs text-slate-600">Un dossier interne, un PDF natif par fournisseur. Les tarifs indicatifs internes et les concurrents n'apparaîtront pas dans les PDF.</p>
     <label className="mt-3 block max-w-xs text-xs font-medium">Date limite de réponse (facultative)<Input type="date" value={deadline} className="mt-1" onChange={e=>setDeadline(e.target.value)}/></label>
    </section>
    <section className="space-y-3 rounded-xl border bg-white p-3 sm:p-4" aria-label="Historique des consultations">
     <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">5. Vérifier les consultations existantes</h3>
      <Button size="sm" variant="outline" onClick={()=>void historyQ.refetch()} disabled={!lineIdsKey||historyQ.isFetching}><RefreshCw className="mr-1 size-3"/>Actualiser</Button></div>
     {!lineIdsKey?<p className="text-sm text-slate-600">Sélectionnez d'abord une ligne de DA.</p>
      :historyQ.isFetching?<p className="text-sm text-slate-600">Recherche des consultations déjà enregistrées…</p>
      :historyQ.isError?<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Impossible de vérifier les consultations existantes : création désactivée. Réessayez.</p>
      :previous.length===0?<p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Aucune consultation antérieure pour les lignes sélectionnées.</p>
      :<div className="space-y-2">{previous.map(entry=><article key={entry.id} className="rounded-lg border p-3 text-sm">
       <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{entry.consultation?.ref??entry.ref}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${entry.status==='open'?'bg-amber-100 text-amber-900':'bg-slate-100 text-slate-700'}`}>{entry.status==='open'?'Ouverte':entry.status==='awarded'?'Attribuée':'Clôturée'}</span></div>
       <p className="mt-1 text-xs text-slate-600">Ligne DA #{entry.requestLineId??'—'} · {entry.qty} {entry.unit} · {new Date(entry.createdAt).toLocaleDateString('fr-FR')}</p>
       <p className="mt-1 text-xs text-slate-600">Fournisseurs : {entry.consultation?.recipients.map(r=>r.name).join(', ')||'RFQ ancienne, sans dossier groupé'}</p>
       {entry.consultation&&<div className="mt-2 flex flex-wrap gap-2">{entry.consultation.recipients.map(r=><Button key={r.supplierId} size="sm" variant="outline" asChild><a target="_blank" rel="noopener noreferrer" href={`/api/p2p/consultations/${entry.consultation!.id}/pdf?supplierId=${r.supplierId}`}><ExternalLink className="mr-1 size-3"/>PDF {r.name}</a></Button>)}</div>}
      </article>)}</div>}
     {needsReconsult&&<div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-amber-950"><AlertTriangle className="size-4"/>Consultation déjà ouverte pour au moins une ligne</p>
      <p className="text-amber-950">Réutilise de préférence la consultation existante et ses documents ci-dessus. Ne prépare une nouvelle consultation que si c'est nécessaire.</p>
      {openRfqs.length>0&&<p className="text-xs text-amber-950">Références détectées au contrôle : {[...new Set(openRfqs.map(r=>r.ref))].join(', ')}</p>}
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-6 accent-[#bd202a]" checked={explicitReconsult} onChange={e=>{setExplicitReconsultKey(e.target.checked?lineIdsKey:null);setReconsultReason('')}}/>
       <span>Créer malgré tout une nouvelle consultation (reconsultation exceptionnelle)</span></label>
      {explicitReconsult&&<label className="block font-medium">Justification obligatoire (10 caractères minimum)
       <Input value={reconsultReason} onChange={e=>setReconsultReason(e.target.value)} maxLength={500} className="mt-1 bg-white" placeholder="Ex. Nouvelle offre requise car délai initial dépassé"/>
       <span className="mt-1 block text-xs font-normal text-amber-900">Motif conservé dans le journal d'audit.</span></label>}
     </div>}
    </section>
    {error&&<p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
   </>}
  </div>
  <DialogFooter className="shrink-0 border-t bg-white px-4 py-3 sm:px-6"><Button variant="outline" onClick={onClose}>{created?'Terminer':'Annuler'}</Button>{!created&&<Button variant="primary" disabled={!canSubmit} onClick={()=>void create()}><Send className="mr-2 size-4"/>{busy?'Enregistrement…':`Préparer la consultation (${selectedLines.length} lignes)`}</Button>}</DialogFooter>
 </DialogContent></Dialog>;
}
