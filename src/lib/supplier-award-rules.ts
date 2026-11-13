/** Règles métier indépendantes du transport HTTP : attribution 1..N fournisseurs. */
import { isValidPurchaseQuantity } from './purchase-quantity.ts';
export const AWARD_EPS = 0.000001;
export type AwardAllocation = {offerId:number;qty:number};
export type EligibleOffer = {
 id:number;supplierId:number;qty:number;quoteRef:string|null;validUntil:Date|null;
 confirmationStatus:string;responseChannel:string;contactName:string|null;callSummary:string|null;
 respondedAt:Date|null;buyerValidatedBy:string|null;buyerValidatedAt:Date|null;
 recordedBy:string|null;documentRef?:string|null;attachments:{id:number}[];
};
export function validateAwardQuantities(qty:number,unit:string,lines:readonly AwardAllocation[],maxPerOffer:ReadonlyMap<number,number>):string|null{
 if(!Number.isFinite(qty)||qty<=0||lines.length<1||lines.length>20)return 'QTE_ATTRIBUTION_INVALIDE';
 if(new Set(lines.map(l=>l.offerId)).size!==lines.length)return 'OFFRE_REPETEE';
 let total=0;
 for(const l of lines){
  if(!isValidPurchaseQuantity(l.qty,unit)||!maxPerOffer.has(l.offerId))return 'OFFRE_OU_QTE_INVALIDE';
  if(l.qty>(maxPerOffer.get(l.offerId)??0)+AWARD_EPS)return 'OFFRE_QTE_DEPASSEE';
  total+=l.qty;
 }
 if(Math.abs(total-qty)>AWARD_EPS)return 'ATTRIBUTION_INCOMPLETE';
 return null;
}
export function offerIsEligibleForAward(o:EligibleOffer,now:Date=new Date()):boolean{
 if(o.confirmationStatus!=='confirmed'||!o.quoteRef||!o.validUntil||o.validUntil<now)return false;
 if(o.responseChannel==='phone')return !!(o.contactName?.trim()&&o.callSummary?.trim()&&o.respondedAt&&o.buyerValidatedBy&&o.buyerValidatedAt);
 return o.responseChannel==='email'?!!o.documentRef?.trim():o.responseChannel==='written'&&o.attachments.length>0;
}
export function approvalIsIndependent(proposer:string,approver:string,rfqCreatedBy:string,offers:readonly Pick<EligibleOffer,'recordedBy'|'buyerValidatedBy'>[]):boolean{
 return proposer!==approver&&rfqCreatedBy!==approver&&offers.every(o=>o.recordedBy!==approver&&o.buyerValidatedBy!==approver);
}

/** P5.15.19: quantités en unités de STOCK, offres et accords sans collisions d'ID. */
export type SourcingAllocation = {sourceType:'QUOTE'|'CONTRACT';sourceId:number;qty:number};
export function validateSourcingAllocations(qty:number,unit:string,lines:readonly SourcingAllocation[],maximums:ReadonlyMap<string,number>):string|null{
 if(!Number.isFinite(qty)||qty<=0||lines.length<1||lines.length>20)return 'QTE_ATTRIBUTION_INVALIDE';
 const keys=lines.map(l=>`${l.sourceType}:${l.sourceId}`);
 if(new Set(keys).size!==keys.length)return 'SOURCE_REPETEE';
 let total=0;
 for(const line of lines){
  const key=`${line.sourceType}:${line.sourceId}`;
  if(!['QUOTE','CONTRACT'].includes(line.sourceType)||!Number.isSafeInteger(line.sourceId)||line.sourceId<=0||!isValidPurchaseQuantity(line.qty,unit)||!maximums.has(key))return 'SOURCE_OU_QTE_INVALIDE';
  if(line.qty>(maximums.get(key)??0)+AWARD_EPS)return 'SOURCE_QTE_DEPASSEE';
  total+=line.qty;
 }
 return Math.abs(total-qty)>AWARD_EPS?'ATTRIBUTION_INCOMPLETE':null;
}
export function contractEligibleForAward(contract:{status:string;approvedBy:string|null;createdBy:string;validFrom:Date;validUntil:Date},now:Date=new Date()):boolean{
 return contract.status==='approved'&&!!contract.approvedBy&&contract.createdBy!==contract.approvedBy&&contract.validFrom<=now&&contract.validUntil>=now;
}
