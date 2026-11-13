/** Référentiel articles SODEPI P5.15.3 : conversion explicite sans arrondi. */
import { isValidPurchaseQuantity } from './purchase-quantity.ts'
export type TradePolicy = {isPurchasable:boolean;isManufactured:boolean;isSellable:boolean;isInternalUse:boolean}
export function validTradePolicy(p:TradePolicy, foamNature?:string|null,category?:string):boolean {
  if(!p.isPurchasable&&!p.isManufactured) return false
  if(!p.isSellable&&!p.isInternalUse) return false
  if(category==='Mousse'&&foamNature==='AGGLO'&&p.isPurchasable)return false
  return true
}
export function stockForSale(saleQty:number,saleUnit:string,stockUnit:string,factor:number):number|null {
  if(!isValidPurchaseQuantity(saleQty,saleUnit)||!Number.isFinite(factor)||factor<=0||factor>1_000_000)return null
  const stockQty=saleQty*factor
  if(!isValidPurchaseQuantity(stockQty,stockUnit))return null
  return stockQty
}
export function validateSalesSettings(stockUnit:string,salesUnit:string,factor:number,salePrice:number):boolean {
  if(!salesUnit||salesUnit.length>24||!Number.isFinite(salePrice)||salePrice<0||salePrice>1e8||
     Math.abs(salePrice*100-Math.round(salePrice*100))>1e-6)return false
  if(stockUnit===salesUnit&&factor!==1)return false
  return stockForSale(1,salesUnit,stockUnit,factor)!==null
}
