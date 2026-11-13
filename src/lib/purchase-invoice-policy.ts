/** RR-02 / RR-03 - supplier invoice controls.
 * No Moroccan tax rate or freight percentage is invented by the software.
 * Production invoices are held for accounting review until approved policy is
 * explicitly configured; demonstration runs remain usable on disposable data.
 */
import {readSalesTaxPolicy} from './sales-tax-policy'

export function supplierInvoicePolicyIssues(args:{
  taxRates:number[]; freightCents:number; goodsCents:number;
  approvedTaxRatesBps?:string; maxFreightBps?:string; strict:boolean;
}):string[]{
  const issues:string[]=[]
  const taxPolicy=readSalesTaxPolicy(args.approvedTaxRatesBps)
  if(args.strict || args.approvedTaxRatesBps?.trim()){
    for(const rate of args.taxRates){
      const bps=Math.round(rate*100)
      if(!Number.isSafeInteger(bps)||Math.abs(bps-rate*100)>1e-6 || !taxPolicy.includes(bps)){
        issues.push('TVA_ACHAT_NON_VALIDEE_PAR_COMPTABILITE');break
      }
    }
  }
  const raw=args.maxFreightBps?.trim() ?? ''
  const valid=/^\d{1,5}$/.test(raw) && Number(raw)>=0 && Number(raw)<=10000
  if(args.freightCents>0 && args.strict && !valid)issues.push('FRET_PLAFOND_NON_CONFIGURE')
  if(args.freightCents>0 && valid && args.freightCents>Math.round(args.goodsCents*Number(raw)/10000))
    issues.push('FRET_HORS_PLAFOND_A_VALIDER')
  return issues
}
