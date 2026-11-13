/** Politique de taux exprimés en points de base (100 = 1 %).
 * AUCUN taux fiscal n'est présumé par le code. La liste est fournie par la
 * configuration SODEPI après validation comptable ; tout taux absent est refusé.
 */
export function readSalesTaxPolicy(raw:string|undefined):number[]{
 if(!raw?.trim())return []
 const tokens=raw.split(",").map(s=>s.trim())
 if(tokens.some(x=>!/^\d{1,5}$/.test(x)))return []
 const values=tokens.map(Number)
 if(values.some(n=>!Number.isSafeInteger(n)||n<0||n>10000))return []
 return [...new Set(values)].sort((a,b)=>a-b)
}
export function salesTaxAllowed(rate:number,raw:string|undefined):boolean {
 return Number.isSafeInteger(rate)&&readSalesTaxPolicy(raw).includes(rate)
}
