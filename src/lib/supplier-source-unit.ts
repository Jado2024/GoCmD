/** P5.13.1: supplier quotations can be priced by stock unit or purchase pack.
 * Sources are converted once, and their conversion factor is frozen.
 * Historical sources with no basis may only be used for identity conversion. */
export type SupplierPriceBasis = "STOCK" | "PURCHASE"
export const closeEnough = (a:number,b:number) => Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=0.000001*Math.max(1,Math.abs(a),Math.abs(b))
export function normaliseSupplierUnitPrice(price:number,basis:SupplierPriceBasis|undefined,unitsPerPurchase:number){
 if(!Number.isFinite(price)||price<=0||!Number.isFinite(unitsPerPurchase)||unitsPerPurchase<=0)throw Error("PRIX_UNITE_INVALIDE")
 if(!basis && !closeEnough(unitsPerPurchase,1))throw Error("UNITE_PRIX_REQUISE")
 if(basis && basis!=="STOCK"&&basis!=="PURCHASE")throw Error("UNITE_PRIX_REQUISE")
 const normalized=basis==="PURCHASE"?price/unitsPerPurchase:price
 if(!Number.isFinite(normalized)||normalized<=0||normalized>1_000_000_000)throw Error("PRIX_UNITE_INVALIDE")
 // Canonical price is MAD per stock unit, to 4 decimal places as in P5.11.
 const stockUnitPrice=Number(normalized.toFixed(4))
 if(stockUnitPrice<=0)throw Error("PRIX_UNITE_INVALIDE")
 return {stockUnitPrice,sourceUnitPrice:price,basis:(basis??"STOCK") as SupplierPriceBasis,conversionFactor:unitsPerPurchase}
}
export function validPriceSourceConversion(source:{priceBasis?:string|null;priceBasisFactor?:number|null;sourceUnitPrice?:number|null;unitPrice:number},factor:number){
 if(!Number.isFinite(factor)||factor<=0)return false
 if(source.priceBasis==null||source.priceBasisFactor==null||source.sourceUnitPrice==null)
  return closeEnough(factor,1) // legacy source, no evidence of conversion
 if(!["STOCK","PURCHASE"].includes(source.priceBasis)||!closeEnough(source.priceBasisFactor,factor))return false
 const expect=source.priceBasis==="PURCHASE"?source.sourceUnitPrice/factor:source.sourceUnitPrice
 return Number.isFinite(expect)&&Math.abs(expect-source.unitPrice)<=0.00011
}
