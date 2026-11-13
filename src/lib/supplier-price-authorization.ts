import { validPriceSourceConversion } from "./supplier-source-unit.ts"
// P5.11 : les prix indicatifs SupplierMaterial ne donnent JAMAIS droit au BC.
export type PriceSourceKind = "CONTRACT" | "QUOTE"
export type PriceSource = {
  type: PriceSourceKind; id:number; supplierId:number; materialId:number;
  unitPrice:number; ref:string; validFrom?:Date|string|null; validUntil?:Date|string|null;
  approved:boolean; requestLineId?:number|null; offeredQty?:number|null;
  priceBasis?:string|null; priceBasisFactor?:number|null; sourceUnitPrice?:number|null;
}
const day=(value:Date|string)=>new Date(value).toISOString().slice(0,10)
export function sourceIsValid(source:PriceSource, input:{supplierId:number;materialId:number;requestLineId:number;qty:number;unitPrice:number;conversionFactor?:number;today?:Date}):boolean{
 const today=day(input.today??new Date())
 if(!source.approved||source.supplierId!==input.supplierId||source.materialId!==input.materialId)return false
 if(Math.abs(source.unitPrice-input.unitPrice)>0.0001||!(input.qty>0))return false
 if(!validPriceSourceConversion(source,input.conversionFactor??1))return false
 if(source.validFrom && day(source.validFrom)>today)return false
 if(!source.validUntil || day(source.validUntil)<today)return false
 if(source.type==="QUOTE")return source.requestLineId===input.requestLineId && source.offeredQty!=null && input.qty<=source.offeredQty+0.000001
 return source.type==="CONTRACT"
}
