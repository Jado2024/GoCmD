/** GoCmd P5.15.0 — Contrat de décision par ligne de DA, sans effet de bord. */
import { isValidPurchaseQuantity } from './purchase-quantity.ts';
export type LineDecision = {lineId:number; decision:'approve'|'reduce'|'reject'; approvedQty?:number; reason?:string};
export type RequestedLine = {id:number;qty:number;unit:string};
export type EvaluatedDecision = {lineId:number;decision:'approved'|'reduced'|'rejected';requestedQty:number;approvedQty:number;reason:string|null};
export function evaluateLineDecisions(lines:readonly RequestedLine[], decisions:readonly LineDecision[]):{
 status:'approved'|'partially_approved'|'rejected'; decisions:EvaluatedDecision[]
}{
 if(lines.length===0||decisions.length!==lines.length||new Set(decisions.map(d=>d.lineId)).size!==lines.length)throw Error('DECISIONS_INCOMPLETE');
 const byId=new Map(decisions.map(d=>[d.lineId,d]));
 const evaluated=lines.map(line=>{
  const input=byId.get(line.id);
  if(!input||!['approve','reduce','reject'].includes(input.decision))throw Error('DECISIONS_INCOMPLETE');
  const qty=input.decision==='approve'?line.qty:input.decision==='reject'?0:input.approvedQty;
  if(qty===undefined||!Number.isFinite(qty)||qty<0||qty>line.qty+0.000001)throw Error('QTE_APPROUVEE_INVALIDE');
  if(input.decision==='approve'&&input.approvedQty!==undefined&&Math.abs(input.approvedQty-line.qty)>0.000001)throw Error('QTE_APPROUVEE_INVALIDE');
  if(input.decision==='reject'&&input.approvedQty!==undefined&&input.approvedQty!==0)throw Error('QTE_APPROUVEE_INVALIDE');
  if(input.decision==='reduce'&&!(qty>0&&qty<line.qty-0.000001))throw Error('QTE_APPROUVEE_INVALIDE');
  if(qty>0&&!isValidPurchaseQuantity(qty,line.unit))throw Error('QTE_UNITE_INVALIDE');
  const reason=input.reason?.trim()??'';
  if(input.decision!=='approve'&&(reason.length<10||reason.length>500))throw Error('MOTIF_OBLIGATOIRE');
  return {lineId:line.id,decision:input.decision==='approve'?'approved':input.decision==='reject'?'rejected':'reduced',requestedQty:line.qty,approvedQty:qty,reason:reason||null} as EvaluatedDecision;
 });
 return {status:evaluated.every(x=>x.approvedQty===0)?'rejected':evaluated.every(x=>x.decision==='approved')?'approved':'partially_approved',decisions:evaluated};
}
