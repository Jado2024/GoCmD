"use client";
import {Phone,FileText,CheckCircle2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {OfferDocuments} from './offer-documents';
import {supplierOfferState,supplierOfferLabel} from '@/lib/supplier-response-status';

export type SupplierResponseOffer={buyerValidatedBy?:string|null;buyerValidatedAt?:string|null;approvedBy?:string|null;approvedAt?:string|null;id:number;supplierId:number;supplierName:string;quoteRef:string|null;unitPrice:string|null;qty:number;leadTimeDays:number;validUntil:string|null;chosen:boolean;confirmationStatus:string;responseChannel:string;hasEmailEvidence?:boolean;hasAttachment:boolean;attachments:{id:number;originalName:string;bytes:number}[];contactName:string|null;callSummary:string|null;respondedAt:string|null};
export type ResponseAction='oralOffer'|'offer'|'confirmOffer'|'validatePhoneOffer'|'reviseOffer';
export function SupplierResponseFlow({rfqId,rfqStatus,material,qty,unit,supplierId,supplierName,supplierPhone,offers,canRecord,canAward,canSeePrices,responseStatus,reminderCount,onStatus,onAction,onUpdated}:{
 rfqId:number;rfqStatus:string;material:string;qty:number;unit:string;supplierId:number;supplierName:string;supplierPhone:string|null;
 offers:SupplierResponseOffer[];canRecord:boolean;canAward:boolean;canSeePrices:boolean;responseStatus:string;reminderCount:number;onStatus:(action:'contacted'|'reminded'|'declined')=>void;
 onAction:(action:ResponseAction,values:Record<string,string>)=>void;onUpdated:()=>void;
}){
 const open=rfqStatus==='open';
 return <section className="space-y-3 border-t pt-3" aria-label={`Réponses de ${supplierName} pour ${material}`}>
  <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
   <div><strong className="block">{material}</strong><span className="text-xs text-slate-500">{qty} {unit} · RFQ #{rfqId}</span></div>
   {canRecord&&supplierPhone&&<a className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50" href={`tel:${supplierPhone.replace(/[^+\d]/g,'')}`}><Phone className="size-3"/>Appeler : {supplierPhone}</a>}
  </div>
  {offers.length===0?<div className="flex flex-wrap items-center gap-2">
    <span className="text-xs text-amber-700">{responseStatus==='declined'?'Refus fournisseur enregistré':responseStatus==='contacted'?'Contacté · réponse attendue':'À contacter · aucune réponse enregistrée'}{reminderCount>0?` · ${reminderCount} relance(s)`:''}</span>
    {canRecord&&open&&responseStatus!=='declined'&&<><Button variant="outline" size="sm" onClick={()=>onStatus('contacted')}>Contacté</Button><Button variant="outline" size="sm" onClick={()=>onStatus('reminded')}>Consigner relance</Button><Button variant="outline" size="sm" onClick={()=>onStatus('declined')}>Refus du fournisseur</Button></>}{canRecord&&canSeePrices&&open&&responseStatus!=='declined'&&<>
     <Button variant="outline" size="sm" onClick={()=>onAction('oralOffer',{rfqId:String(rfqId),supplierId:String(supplierId),qty:String(qty)})}><Phone className="mr-1 size-3"/>Enregistrer l’appel</Button>
     <Button variant="outline" size="sm" onClick={()=>onAction('offer',{rfqId:String(rfqId),supplierId:String(supplierId),qty:String(qty),evidenceChannel:'written'})}><FileText className="mr-1 size-3"/>Saisir le devis PDF</Button>
     <Button variant="outline" size="sm" onClick={()=>onAction('offer',{rfqId:String(rfqId),supplierId:String(supplierId),qty:String(qty),evidenceChannel:'email'})}>Saisir l’offre e-mail</Button>
    </>}
   </div>:offers.map(o=>{const status=supplierOfferState(o,rfqStatus);return <article key={o.id} className="space-y-2 rounded-lg border bg-slate-50/60 p-3 text-xs">
    <div className="flex flex-wrap items-start justify-between gap-2">
     <div className="space-y-1"><strong className="block">Offre #{o.id} · {o.responseChannel==='phone'?'Téléphone':o.responseChannel==='email'?'E-mail':'PDF'}</strong>
      <span className="block font-medium text-slate-700">{supplierOfferLabel(status)}</span>
      {canSeePrices&&<span className="block">{o.unitPrice??'—'} MAD / {unit} · {o.qty} {unit} · délai {o.leadTimeDays} j</span>}
      {o.quoteRef&&<span className="block">{o.responseChannel==='phone'&&o.quoteRef.startsWith('TEL-')?'Référence interne :':'Devis :'} {o.quoteRef}</span>}
      {o.respondedAt&&<span className="block text-slate-500">{o.responseChannel==='phone'?'Appel du':'Réponse du'} {new Date(o.respondedAt).toLocaleString('fr-FR')}</span>}
      {o.contactName&&<span className="block">Interlocuteur : {o.contactName}</span>}{o.buyerValidatedBy&&<span className="block">Validée par l’acheteur : {o.buyerValidatedBy}</span>}{o.approvedBy&&<span className="block">Approuvée par : {o.approvedBy}</span>}
      {o.callSummary&&<p className="max-w-xl whitespace-pre-wrap break-words text-slate-600">Compte rendu : {o.callSummary}</p>}
     </div>
     <span className={`rounded-full px-2 py-1 font-medium ${status==='ready_to_award'||status==='awarded'?'bg-emerald-100 text-emerald-900':status==='closed'?'bg-slate-200 text-slate-700':'bg-amber-100 text-amber-900'}`}>{status==='awarded'?'Attribuée':status==='ready_to_award'?'Validée':status==='closed'?'Clôturée':'À compléter'}</span>
    </div>
    {canSeePrices&&<OfferDocuments offerId={o.id} items={o.attachments??[]} canUpload={canRecord&&open&&!o.chosen} onUploaded={onUpdated}/>}
    <div className="flex flex-wrap items-center gap-2">
     {status==='oral_pending'&&o.responseChannel==='phone'&&canRecord&&canSeePrices&&<Button variant="outline" size="sm" onClick={()=>onAction('validatePhoneOffer',{offerId:String(o.id)})}><CheckCircle2 className="mr-1 size-3"/>Valider l’offre téléphonique sans PDF</Button>}
     {status==='oral_to_confirm'&&canRecord&&canSeePrices&&<Button variant="outline" size="sm" onClick={()=>onAction('confirmOffer',{offerId:String(o.id)})}><CheckCircle2 className="mr-1 size-3"/>Confirmer avec le PDF</Button>}
     {status==='ready_to_award'&&canAward&&canSeePrices&&<span className="text-emerald-800">À sélectionner dans le comparateur ci-dessus.</span>}
     {status==='ready_to_award'&&!canAward&&<span className="text-slate-600">L’acheteur prépare le plan d’attribution dans le comparateur.</span>}
     {canRecord&&canSeePrices&&open&&!o.chosen&&<Button variant="outline" size="sm" onClick={()=>onAction('reviseOffer',{offerId:String(o.id),qty:String(o.qty),unitPrice:String(o.unitPrice??''),leadTimeDays:String(o.leadTimeDays)})}>Réviser cette offre</Button>}
     {status==='oral_pending'&&o.responseChannel==='phone'&&<span className="text-amber-800">Compte rendu conservé. Le PDF est facultatif ; l’acheteur doit valider l’offre.</span>}
     {status==='written_pdf_missing'&&<span className="text-amber-800">Un devis écrit sans PDF ne peut pas être attribué.</span>}
     {status==='awarded'&&<span className="text-emerald-800">L’attribution n’émet pas automatiquement de BC.</span>}
    </div>
   </article>})}
  {!canSeePrices&&<p className="text-xs text-amber-800">Tarifs et devis : accès réservé aux comptes disposant de l’autorisation de lecture des coûts.</p>}
 </section>
}
