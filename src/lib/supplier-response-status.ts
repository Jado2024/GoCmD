/** Statuts lisibles : la validation acheteur de l'oral ne dépend pas du PDF. */
export type SupplierOfferState='awarded'|'closed'|'oral_pending'|'oral_to_confirm'|'written_pdf_missing'|'ready_to_award';
export function supplierOfferState(offer:{chosen:boolean;confirmationStatus:string;hasAttachment:boolean;hasEmailEvidence?:boolean;responseChannel?:string;buyerValidatedBy?:string|null;buyerValidatedAt?:string|null},rfqStatus:string):SupplierOfferState{
 if(offer.chosen)return 'awarded';
 if(rfqStatus!=='open')return 'closed';
 if(offer.responseChannel==='email'&&offer.confirmationStatus==='confirmed'&&offer.hasEmailEvidence)return 'ready_to_award';
 if(offer.responseChannel==='phone'){
  if(offer.confirmationStatus==='pending')return offer.hasAttachment?'oral_to_confirm':'oral_pending';
  return offer.confirmationStatus==='confirmed'&&!!offer.buyerValidatedBy&&!!offer.buyerValidatedAt?'ready_to_award':'oral_pending';
 }
 if(offer.confirmationStatus==='pending')return offer.hasAttachment?'oral_to_confirm':'oral_pending';
 return offer.hasAttachment?'ready_to_award':'written_pdf_missing';
}
export function supplierOfferLabel(state:SupplierOfferState):string{
 const labels:Record<SupplierOfferState,string>={
  awarded:'Offre attribuée — BC à préparer',closed:'Consultation clôturée',
  oral_pending:'Offre téléphonique — validation acheteur nécessaire',
  oral_to_confirm:'PDF reçu — confirmer et valider l’offre',
  written_pdf_missing:'Devis écrit — PDF justificatif manquant',
  ready_to_award:'Offre validée — approbation responsable possible'
 };
 return labels[state];
}
