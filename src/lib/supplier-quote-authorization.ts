/** Contrôle unique des offres attribuées : appelé dans les listes ET au moment du BC. */
export type QuoteEvidence={
 chosen:boolean;confirmationStatus:string;responseChannel:string;quoteRef:string|null;
 validUntil:Date|null;documentRef?:string|null;attachments:{id:number}[];
 contactName:string|null;callSummary:string|null;respondedAt:Date|null;
 buyerValidatedBy:string|null;buyerValidatedAt:Date|null;approvedBy:string|null;approvedAt:Date|null;recordedBy?:string|null;
};
export function isAuthorizedSupplierQuote(q:QuoteEvidence, now:Date=new Date()):boolean{
 if(!q.chosen||q.confirmationStatus!=='confirmed'||!q.quoteRef||!q.validUntil||q.validUntil<now||!q.approvedBy||!q.approvedAt)return false;
 if(q.responseChannel==='phone')return !!(
  q.contactName?.trim()&&q.callSummary?.trim()&&q.respondedAt&&
  q.buyerValidatedBy?.trim()&&q.buyerValidatedAt&&
  q.approvedBy?.trim()&&q.approvedAt&&q.approvedBy!==q.buyerValidatedBy&&q.approvedBy!==q.recordedBy
 );
 return q.approvedBy!==q.recordedBy&&(q.responseChannel==='email'?!!q.documentRef?.trim():q.responseChannel==='written'&&q.attachments.length>0);
}
