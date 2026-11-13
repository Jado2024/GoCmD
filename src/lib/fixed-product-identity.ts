/** V2 — identités stables des produits finis fixes (hors négoce et GEN). */
import {createHash} from "node:crypto"
export type PfSpec={family:string;model:string;variant?:string;length:number;width:number;height:number;
 coreType?:string|null;foamComposition?:string|null;mattressFinish?:string|null;upholstery?:string|null;
 foamNature?:string|null;foamGrade?:string|null;foamDensity?:number|null;foamLayers?:string|null;
 specialNotes?:string|null}
function token(v:string){return v.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-|-$/g,"")}
export function fixedProductIdentity(spec:PfSpec){
 const attrs:Record<string,string|number>={family:spec.family,model:spec.model,variant:spec.variant??"STD",
   length:spec.length,width:spec.width,height:spec.height}
 for(const k of ["coreType","foamComposition","mattressFinish","upholstery","foamNature","foamGrade","foamDensity","foamLayers","specialNotes"] as const){
   if(spec[k]!==undefined&&spec[k]!==null&&spec[k]!=="")attrs[k]=spec[k]!
 }
 const ordered=Object.fromEntries(Object.entries(attrs).sort(([a],[b])=>a.localeCompare(b)))
 const identity=JSON.stringify({schema:"GOCMD-PF-V2",attributes:ordered})
 const family=token(spec.family).slice(0,3)
 const codeModel=token(spec.model).slice(0,25)
 const opts=["coreType","foamComposition","mattressFinish","upholstery","foamNature"]
  .map(k=>attrs[k]?token(String(attrs[k])).slice(0,12):null).filter((v):v is string=>Boolean(v))
 const dimensions=`${spec.length}X${spec.width}X${spec.height}CM`
 const prefix=["PF",family,codeModel,...opts,dimensions,token(spec.variant??"STD")].join("-")
 const digest=createHash("sha256").update(identity).digest("hex").slice(0,12).toUpperCase()
 const sku=`${prefix.slice(0,140)}-${digest}`
 return {identity,sku,attributes:attrs}
}
