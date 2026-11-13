/** Individual price approvals for immutable quote lines; no approval transfers to another configuration. */
import {createHash} from "node:crypto"
import type {Product} from "@prisma/client"
import {hasPriceException} from "./commercial-authorization"
export type QuoteLine = {productId:number;unitPrice:number;generic?:{template:string}|undefined}
export type QuoteLineVisa = {by:string;at:string;reason:string;digest:string}
export type QuoteVisas = Record<string,QuoteLineVisa>
export function quoteLineDigest(line:unknown):string {return createHash("sha256").update(JSON.stringify(line)).digest("hex")}
export function readQuoteVisas(raw:string|null|undefined):QuoteVisas {
 if(!raw)return {}
 try {const obj=JSON.parse(raw);if(obj&&typeof obj==="object"&&!Array.isArray(obj))return obj as QuoteVisas} catch{}
 return {}
}
export function quoteNeedsVisa(line:QuoteLine,product:Product|null|undefined):boolean {
 if(line.generic)return true
 return !!product&&!product.specialNotes&&hasPriceException(line.unitPrice,product.unitPrice)
}
export function quoteLineVisaValid(visas:QuoteVisas,index:number,line:QuoteLine):boolean {
 const visa=visas[String(index)]
 return !!visa&&typeof visa.by==="string"&&visa.by.length>0&&typeof visa.reason==="string"&&visa.reason.length>=8&&visa.digest===quoteLineDigest(line)
}

export type QuotePricePlan = {digest:string;required:boolean;catalogPrice:number|null}[]
export function createQuotePricePlan(lines:QuoteLine[],byId:Map<number,Product>):QuotePricePlan {
 return lines.map(line=>{
  const product=line.generic?null:byId.get(line.productId)
  if(!line.generic&&!product)throw new Error("QUOTE_PRODUCT_MISSING")
  return {digest:quoteLineDigest(line),required:quoteNeedsVisa(line,product),catalogPrice:product?.unitPrice??null}
 })
}
/** Do not re-evaluate eligibility against the *current* catalogue: a quote is immutable. */
export function quoteReviewPlan(raw:string|null|undefined,lines:QuoteLine[]):QuotePricePlan {
 if(!raw)throw new Error("QUOTE_LEGACY_PLAN_MISSING")
 let parsed:unknown
 try {parsed=JSON.parse(raw)}catch{throw new Error("QUOTE_PLAN_INVALID")}
 if(!Array.isArray(parsed)||parsed.length!==lines.length||parsed.some((p,i)=>
  !p||typeof p!=="object"||typeof p.required!=="boolean"||p.digest!==quoteLineDigest(lines[i])||
  (p.catalogPrice!==null&&(typeof p.catalogPrice!=="number"||!Number.isFinite(p.catalogPrice)))))throw new Error("QUOTE_PLAN_INVALID")
 return parsed as QuotePricePlan
}
