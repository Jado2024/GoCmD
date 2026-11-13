"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';

type Offer={id:number;supplierName:string;unitPrice:string|null;qty:number;leadTimeDays:number;validUntil:string|null;confirmationStatus:string;responseChannel:string;buyerValidatedBy?:string|null;paymentTerms?:string|null;hasEmailEvidence?:boolean;hasAttachment:boolean};
type Contract={id:number;supplierName:string;contractRef:string;documentRef:string;unitPrice:string;validFrom:string;validUntil:string;leadTimeDays:number|null;purchaseUnit:string|null;paymentTerms:string|null;status:string};
type PlanLine={sourceType?:'QUOTE'|'CONTRACT';sourceId?:number;offerId:number|null;supplierId:number;qty:number;unitPrice:string|null;ref?:string|null};
type AwardPlan={id:number;status:string;proposedBy:string;decidedBy:string|null;reason:string|null;decisionNote:string|null;lines:PlanLine[]};
type Candidate={key:string;kind:'QUOTE'|'CONTRACT';id:number;supplierName:string;ref:string;price:number;qty:number;leadTimeDays:number|null;validUntil:string|null;paymentTerms:string|null;proof:string;eligible:boolean};

export function AwardPlanPanel({rfqId,rfqStatus,material,unit,qty,offers,contracts,plans,canPropose,canApprove,canSeePrices,onUpdated}:{
 rfqId:number;rfqStatus:string;material:string;unit:string;qty:number;offers:Offer[];contracts:Contract[];plans:AwardPlan[];
 canPropose:boolean;canApprove:boolean;canSeePrices:boolean;onUpdated:()=>void;
}){
 const [amounts,setAmounts]=useState<Record<string,string>>({});
 const [reason,setReason]=useState('');
 const [decisionNote,setDecisionNote]=useState('');
 const [filter,setFilter]=useState<'all'|'contract'|'quote'|'waiting'>('all');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const current=plans.find(p=>p.status==='pending'||p.status==='approved');
 const now=new Date();
 const ready=(o:Offer)=>o.confirmationStatus==='confirmed'&&!!o.validUntil&&new Date(o.validUntil)>=now&&(
  o.responseChannel==='phone'?!!o.buyerValidatedBy:o.responseChannel==='email'?!!o.hasEmailEvidence:o.responseChannel==='written'&&o.hasAttachment);
 const candidates:Candidate[]=[
  ...contracts.map(c=>({key:`CONTRACT:${c.id}`,kind:'CONTRACT' as const,id:c.id,supplierName:c.supplierName,ref:c.contractRef,price:Number(c.unitPrice),qty,leadTimeDays:c.leadTimeDays,validUntil:c.validUntil,paymentTerms:c.paymentTerms,proof:`Contrat ${c.contractRef} · ${c.documentRef}`,eligible:c.status==='approved'&&new Date(c.validFrom)<=now&&new Date(c.validUntil)>=now})),
  ...offers.filter(o=>o.unitPrice!==null).map(o=>({key:`QUOTE:${o.id}`,kind:'QUOTE' as const,id:o.id,supplierName:o.supplierName,ref:`Offre #${o.id}`,price:Number(o.unitPrice),qty:o.qty,leadTimeDays:o.leadTimeDays,validUntil:o.validUntil,paymentTerms:o.paymentTerms??null,proof:o.responseChannel==='phone'?'Téléphone + validation acheteur':o.responseChannel==='email'?'E-mail':'PDF',eligible:ready(o)}))
 ];
 const visible=candidates.filter(c=>filter==='all'||filter==='contract'&&c.kind==='CONTRACT'||filter==='quote'&&c.kind==='QUOTE'||filter==='waiting'&&!c.eligible)
  .sort((a,b)=>a.price-b.price||(a.leadTimeDays??Number.MAX_SAFE_INTEGER)-(b.leadTimeDays??Number.MAX_SAFE_INTEGER)||a.key.localeCompare(b.key));
 const total=candidates.reduce((n,c)=>n+Number(amounts[c.key]||0),0);
 const allocationValid=candidates.filter(c=>Number(amounts[c.key]||0)>0).every(c=>c.eligible&&Number(amounts[c.key])<=c.qty+0.000001);
 const selected=candidates.filter(c=>Number(amounts[c.key]||0)>0);
 const overlaps=contracts.some(c=>contracts.some(d=>d.id!==c.id&&d.supplierName===c.supplierName&&c.validFrom<=d.validUntil&&d.validFrom<=c.validUntil));
 async function execute(action:'propose'|'approve'|'reject'|'createDraftOrders'|'defer'){
  setNotice('');setBusy(true);
  try{
   const payload:Record<string,unknown>={action};
   if(action==='propose'){
    if(Math.abs(total-qty)>0.000001||!allocationValid)throw Error(`Répartir exactement ${qty} ${unit}, sans dépasser la quantité disponible pour chaque source.`);
    if(reason.trim().length<20)throw Error('Justifier le choix avec au moins 20 caractères (prix, délai, qualité, disponibilité).');
    payload.rfqId=rfqId;payload.reason=reason;
    payload.allocations=selected.map(c=>({sourceType:c.kind,sourceId:c.id,qty:Number(amounts[c.key])}));
   }else if(action==='defer'){
    if(decisionNote.trim().length<10)throw Error('Préciser pourquoi attendre les autres offres (10 caractères minimum).');
    payload.rfqId=rfqId;payload.reason=decisionNote;
   }else{
    if(!current)throw Error('Aucun plan en cours.');
    payload.planId=current.id;
    if(action==='reject'&&decisionNote.trim().length<10)throw Error('Motif de rejet obligatoire (10 caractères minimum).');
    if(decisionNote.trim())payload.decisionNote=decisionNote;
   }
   const response=await fetch('/api/p2p/awards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const body=await response.json();if(!response.ok)throw Error(body.error??'Décision refusée');
   const messages={propose:'Attribution soumise au responsable achats (aucun BC créé).',approve:'Attribution approuvée par le responsable. L’acheteur peut préparer les BC.',reject:'Plan rejeté : l’acheteur peut proposer un nouveau choix.',defer:'Décision « attendre » enregistrée. Consultation ouverte, aucun BC créé.',createDraftOrders:`BC brouillons créés : ${(body.result?.orders??[]).map((o:{ref:string})=>o.ref).join(', ')}. Approbation BC indépendante obligatoire.`};
   setNotice(messages[action]);onUpdated();
  }catch(e){setNotice(e instanceof Error?e.message:'Erreur inconnue');}finally{setBusy(false)}
 }
 return <section className="space-y-3 rounded-lg border border-slate-300 bg-white p-3" aria-label={`Comparateur ${material}`}>
  <div className="flex flex-wrap items-center justify-between gap-2">
   <div><h3 className="font-semibold text-sm">Sources d’achat — {material}</h3><p className="text-xs text-slate-600">RFQ #{rfqId} · Besoin à attribuer : {qty} {unit}</p></div>
   <span className="text-xs text-slate-600">{contracts.length} contrat(s) actif(s) · {offers.length} offre(s) reçue(s)</span>
  </div>
  {!canSeePrices?<p className="text-xs text-amber-700">Prix et décision d’attribution réservés aux comptes achats habilités.</p>:<>
   <p className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">Les prix contractuels sont proposés automatiquement. L’acheteur peut les comparer à d’autres offres ; seul le responsable valide le choix. Un contrat actif ne crée jamais un BC automatiquement.</p>
   {overlaps&&<p role="alert" className="rounded bg-amber-50 p-2 text-xs text-amber-800">Plusieurs contrats en vigueur se chevauchent pour un même fournisseur : choisir explicitement la référence et justifier le choix.</p>}
   <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les sources d’achat">
    {([['all','Toutes'],['contract','Sous contrat'],['quote','Offres reçues'],['waiting','À compléter']] as const).map(([key,label])=><Button key={key} type="button" size="sm" variant={filter===key?'primary':'outline'} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</Button>)}
   </div>
   <div className="overflow-x-auto"><table className="w-full min-w-[870px] border-collapse text-left text-xs"><thead><tr className="border-b text-slate-600"><th className="py-2 pr-2">Source / Fournisseur</th><th>Prix MAD/{unit}</th><th>Qté max</th><th>Total hors frais</th><th>Délai</th><th>Validité</th><th>Conditions</th><th>Justificatif</th><th>Attribuer ({unit})</th></tr></thead><tbody>
    {visible.map(c=><tr key={c.key} className="border-b"><td className="py-2 pr-2 font-medium">{c.supplierName}<span className="block font-normal text-slate-600">{c.kind==='CONTRACT'?'Contrat actif':'Devis fournisseur'} · {c.ref}</span></td><td className="tabular-nums">{c.price.toLocaleString('fr-MA',{maximumFractionDigits:4})}</td><td>{c.kind==='CONTRACT'?`Jusqu’à ${c.qty}`:c.qty}</td><td>{(c.price*c.qty).toLocaleString('fr-MA',{maximumFractionDigits:2})} MAD</td><td>{c.leadTimeDays===null?'À confirmer':`${c.leadTimeDays} j`}</td><td>{c.validUntil?.slice(0,10)??'—'}</td><td>{c.paymentTerms??'À vérifier'}</td><td>{c.proof}<span className={`block ${c.eligible?'text-emerald-700':'text-amber-700'}`}>{c.eligible?'Sélectionnable':'En attente / non valide'}</span></td><td><Input aria-label={`Quantité attribuée ${c.ref} ${c.supplierName}`} type="number" min="0" max={Math.min(c.qty,qty)} step="any" className="h-8 w-24" value={amounts[c.key]??''} disabled={!canPropose||rfqStatus!=='open'||!!current||!c.eligible||busy} onChange={e=>setAmounts(v=>({...v,[c.key]:e.target.value}))}/></td></tr>)}
   </tbody></table></div>
   {visible.length===0&&<p className="text-xs text-slate-600">Aucune source correspondante. Consultez les fournisseurs ou vérifiez les contrats.</p>}
   {current?<div className="rounded-md bg-slate-50 p-3 text-sm">
    <p className="font-semibold">Plan #{current.id} · {current.status==='pending'?'Décision du responsable attendue':'Approuvé'}</p>
    <p className="mt-1 text-xs">Acheteur : {current.proposedBy}{current.decidedBy?` · Responsable : ${current.decidedBy}`:''}</p>
    <p className="mt-1 whitespace-pre-wrap text-xs">Motif : {current.reason}</p>
    <ul className="ml-4 list-disc text-xs">{current.lines.map((l,i)=><li key={`${l.sourceType??'QUOTE'}:${l.sourceId??l.offerId}:${i}`}>
     {l.sourceType==='CONTRACT'?`Contrat ${l.ref??l.sourceId}`:offers.find(o=>o.id===l.offerId)?.supplierName??`Offre #${l.offerId}`} : {l.qty} {unit} × {l.unitPrice} MAD/{unit}</li>)}</ul>
    <div className="mt-3 flex flex-wrap gap-2">{current.status==='pending'&&canApprove&&<><Button size="sm" onClick={()=>void execute('approve')} disabled={busy}>Retenir ces sources</Button><Button size="sm" variant="outline" onClick={()=>void execute('reject')} disabled={busy}>Rejeter et reconsulter</Button></>}{current.status==='approved'&&canPropose&&<Button size="sm" onClick={()=>void execute('createDraftOrders')} disabled={busy}>Préparer les BC brouillons</Button>}</div>
    {current.status==='pending'&&canApprove&&<Textarea aria-label="Motif de décision" placeholder="Motif obligatoire si rejet" value={decisionNote} onChange={e=>setDecisionNote(e.target.value)} className="mt-2"/>}
   </div>:rfqStatus==='open'&&<div className="space-y-2">
    <p className="text-xs">Répartition : <strong>{total} / {qty} {unit}</strong> · {candidates.filter(c=>c.eligible).length} source(s) éligible(s)</p>
    {canPropose&&<><Textarea aria-label="Motivation de l'attribution" placeholder="Pourquoi retenir ces fournisseurs ? Prix, délai, coût rendu, qualité (20 caractères minimum)" value={reason} onChange={e=>setReason(e.target.value)}/><Button size="sm" disabled={busy||!allocationValid||Math.abs(total-qty)>0.000001||reason.trim().length<20} onClick={()=>void execute('propose')}>Soumettre le choix au responsable</Button></>}
    {canApprove&&<div className="rounded-md border p-2"><p className="mb-2 text-xs">Le responsable peut attendre les nouvelles réponses sans passer de commande.</p><Textarea aria-label="Justification de l'attente" placeholder="Motif de l’attente (10 caractères minimum)" value={decisionNote} onChange={e=>setDecisionNote(e.target.value)}/><Button className="mt-2" size="sm" variant="outline" disabled={busy||decisionNote.trim().length<10} onClick={()=>void execute('defer')}>Attendre d’autres offres — sans BC</Button></div>}
    {!canPropose&&!canApprove&&<p className="text-xs text-slate-600">L’acheteur prépare l’attribution ; le responsable décide.</p>}
   </div>}
   {notice&&<p className="rounded bg-slate-50 p-2 text-xs" role="status">{notice}</p>}
   <p className="text-[11px] text-slate-600">Les montants affichés sont hors transport, taxes et autres frais. Le responsable doit comparer le coût rendu et vérifier les conditions avant de retenir la source.</p>
  </>}
 </section>;
}
