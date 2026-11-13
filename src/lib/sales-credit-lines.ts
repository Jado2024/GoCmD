/** Calcul en centimes, répartition déterministe de la taxe d'une facture
 * (taxe initialement arrondie globalement sur l'ensemble du document).
 * Un avoir intégral de toutes les lignes reconstitue exactement le TTC.
 */
export type TaxInvoiceLine={id:number,amountCents:number,qty:number}
export function allocateInvoiceTax(lines:readonly TaxInvoiceLine[],subtotalCents:number,taxCents:number):Map<number,number>{
 if(!Number.isSafeInteger(subtotalCents)||!Number.isSafeInteger(taxCents)||subtotalCents<0||taxCents<0)throw Error("INVALID_TAX_TOTAL")
 // C4-07 (contre-audit CASCADE4) : ids en double écrasaient une allocation dans
 // la Map et perdaient silencieusement des centimes de taxe ; les ids de lignes
 // de facture sont uniques en base — tout doublon est une donnée corrompue.
 if(new Set(lines.map(l=>l.id)).size!==lines.length)throw Error("INVOICE_LINES_MISMATCH")
 if(lines.reduce((s,l)=>s+l.amountCents,0)!==subtotalCents)throw Error("INVOICE_LINES_MISMATCH")
 if(!subtotalCents){if(taxCents)throw Error("INVALID_TAX_TOTAL");return new Map(lines.map(l=>[l.id,0]))}
 const allocations=lines.map(l=>{
  const raw=taxCents*l.amountCents/subtotalCents
  return {id:l.id,base:Math.floor(raw),fraction:raw-Math.floor(raw)}
 })
 let extra=taxCents-allocations.reduce((s,l)=>s+l.base,0)
 allocations.sort((a,b)=>b.fraction-a.fraction||a.id-b.id)
 for(const l of allocations){if(extra<=0)break;l.base++;extra--}
 return new Map(allocations.map(l=>[l.id,l.base]))
}
/** Le dernier crédit de quantité reçoit exactement le solde arrondi de la ligne. */
export function partialLineCredit(lineTotalCents:number,originalQty:number,newQty:number,alreadyQty:number,alreadyCents:number):number{
 // C4-07 (contre-audit CASCADE4) : un NaN franchissait les gardes (les
 // comparaisons avec NaN sont fausses) et renvoyait NaN comme montant d'avoir.
 if(!Number.isSafeInteger(lineTotalCents)||lineTotalCents<0||!Number.isFinite(originalQty)||!Number.isFinite(newQty)||!Number.isFinite(alreadyQty)||!Number.isSafeInteger(alreadyCents)||alreadyCents<0)throw Error("INVALID_CREDIT")
 if(originalQty<=0||newQty<=0||alreadyQty<0||alreadyQty>originalQty)throw Error("INVALID_CREDIT")
 if(newQty>originalQty-alreadyQty+1e-7)throw Error("CREDIT_QTY_EXCEEDED")
 const remaining=lineTotalCents-alreadyCents
 if(remaining<0)throw Error("CREDIT_AMOUNT_EXCEEDED")
 const value=newQty>=originalQty-alreadyQty-1e-7?remaining:Math.round(lineTotalCents*newQty/originalQty)
 if(value>remaining)throw Error("CREDIT_AMOUNT_EXCEEDED")
 return value
}
