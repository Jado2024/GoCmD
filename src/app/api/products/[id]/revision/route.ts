/** V2 R4 : révisions de fiches PF fixes, sans réécrire leurs historiques. */
import { NextRequest,NextResponse } from "next/server"
import {z} from "zod"
import {accessGate,currentActor,hasRole,hasPermission} from "@/lib/access-gate"
import {db} from "@/lib/db"
import {serializedSQLiteWrite} from "@/lib/sqlite-write"
import {fixedProductIdentity} from "@/lib/fixed-product-identity"
import {validateTechnicalSpecs} from "@/lib/product-taxonomy"
import {safeErrorMetadata} from "@/lib/safe-server-error"
export const dynamic="force-dynamic"
const Opt={
 model:z.string().trim().min(2).max(120).optional(),variant:z.string().trim().min(1).max(20).optional(),
 length:z.number().int().positive().max(1500).optional(),width:z.number().int().positive().max(1500).optional(),height:z.number().int().positive().max(1500).optional(),
 coreType:z.enum(["SANS_RESSORTS","BONNELL","ENSACHES"]).nullable().optional(),
 foamComposition:z.enum(["PURE","MELANGE","AGGLO"]).nullable().optional(),
 mattressFinish:z.enum(["SANS","TOPPER","ALESE"]).nullable().optional(),
 upholstery:z.enum(["NUE","TISSU"]).nullable().optional(),foamNature:z.enum(["PURE","AGGLO"]).nullable().optional(),
 foamGrade:z.string().trim().max(80).nullable().optional(),foamDensity:z.number().positive().max(500).nullable().optional(),
 foamLayers:z.string().max(5000).nullable().optional(),
}
const Input=z.discriminatedUnion("action",[
 z.object({action:z.literal("propose"),reason:z.string().trim().min(12).max(500),changes:z.object(Opt).strict()}).strict(),
 z.object({action:z.enum(["approve","reject"]),reason:z.string().trim().min(12).max(500)}).strict(),
])
const error=(message:string,status=409)=>NextResponse.json({error:message},{status})
async function productId(ctx:{params:Promise<{id:string}>}){const id=Number((await ctx.params).id);return Number.isSafeInteger(id)&&id>0?id:null}
export async function GET(req:NextRequest,ctx:{params:Promise<{id:string}>}){
 const denied=accessGate(req);if(denied)return denied
 const id=await productId(ctx);if(!id)return error("Identifiant invalide",400)
 const source=await db.product.findUnique({where:{id},select:{id:true,isOrderScoped:true}})
 if(!source||source.isOrderScoped)return error("Produit introuvable",404)
 const revisions=await db.product.findMany({where:{revisionOfId:id},select:{id:true,sku:true,status:true,revisionNumber:true,revisionRequestedBy:true,revisionApprovedBy:true,name:true,createdAt:true},orderBy:[{revisionNumber:"desc"},{id:"desc"}],take:50})
 return NextResponse.json({items:revisions},{headers:{"Cache-Control":"private, no-store"}})
}
export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}){
 const gate=accessGate(req);if(gate)return gate
 const id=await productId(ctx);if(!id)return error("Identifiant invalide",400)
 const parsed=Input.safeParse(await req.json().catch(()=>null));if(!parsed.success)return error("Révision invalide : motif de 12 caractères, modifications techniques et décision explicite",400)
 const {action,reason}=parsed.data,actor=currentActor(req)!.username
 if(action==="propose"&&(!hasRole(req,"approver")||(currentActor(req)?.managed&&!hasPermission(req,"sales.approve"))))return error("Proposition réservée au responsable",403)
 if(action!=="propose"&&(!hasRole(req,"director")||(currentActor(req)?.managed&&!hasPermission(req,"director.prices"))))return error("Décision réservée à un directeur habilité",403)
 try{
  const result=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   const original=await tx.product.findUnique({where:{id}})
   if(!original||original.materialId!=null||original.isOrderScoped||!original.canonicalIdentity)throw Error("NOT_FIXED")
   if(action==="propose"){
    if(original.status!=="active")throw Error("SOURCE_NOT_ACTIVE")
    const candidate={...original,...parsed.data.changes}
    const technicalError=validateTechnicalSpecs(candidate)
    if(technicalError)throw Error(`SPEC_${technicalError}`)
    const coded=fixedProductIdentity(candidate)
    if(coded.identity===original.canonicalIdentity)throw Error("NO_TECHNICAL_CHANGE")
    const duplicate=await tx.product.findUnique({where:{canonicalIdentity:coded.identity},select:{id:true,sku:true}})
    if(duplicate)throw Error(`EXISTING_${duplicate.sku}`)
    const latest=await tx.product.findFirst({where:{OR:[{id},{revisionOfId:id}]},select:{revisionNumber:true},orderBy:{revisionNumber:"desc"}})
    const revisionNumber=(latest?.revisionNumber??1)+1
    const created=await tx.product.create({data:{
      sku:coded.sku,canonicalIdentity:coded.identity,technicalAttributesJson:JSON.stringify(coded.attributes),
      revisionOfId:id,revisionNumber,revisionRequestedBy:actor,status:"pending_validation",revisionApprovedBy:null,
      name:candidate.descriptionOverride?.trim()||`${candidate.family} ${candidate.model} ${candidate.length}×${candidate.width}×${candidate.height}`,
      family:candidate.family,model:candidate.model,variant:candidate.variant,length:candidate.length,width:candidate.width,height:candidate.height,
      unit:original.unit,unitPrice:original.unitPrice,minStock:0,targetStock:null,
      subCategory:original.subCategory,commercialAbbreviation:original.commercialAbbreviation,commercialBrand:original.commercialBrand,
      actualManufacturer:original.actualManufacturer,descriptionOverride:original.descriptionOverride,
      coreType:candidate.coreType,foamComposition:candidate.foamComposition,mattressFinish:candidate.mattressFinish,
      upholstery:candidate.upholstery,foamNature:candidate.foamNature,foamGrade:candidate.foamGrade,
      foamDensity:candidate.foamDensity,foamLayers:candidate.foamLayers,
      similarProductId:id,similarProductSku:original.sku,taxonomyVersion:original.taxonomyVersion,
    }})
    await tx.auditEvent.create({data:{actor,action:"PF_TECHNICAL_REVISION_PROPOSED",entity:"Product",entityId:String(created.id),
      details:JSON.stringify({revisionOfId:id,sourceSku:original.sku,newSku:created.sku,revisionNumber,reason,from:original.canonicalIdentity,to:coded.identity})}})
    return {productId:created.id,sku:created.sku,status:created.status,revisionNumber}
   }
   if(original.revisionOfId==null||original.status!=="pending_validation")throw Error("INVALID_REVIEW_STATE")
   if(!original.revisionRequestedBy||original.revisionRequestedBy===actor)throw Error("FOUR_EYES_REQUIRED")
   const updated=await tx.product.update({where:{id},data:{status:action==="approve"?"active":"rejected",revisionApprovedBy:actor}})
   await tx.auditEvent.create({data:{actor,action:action==="approve"?"PF_TECHNICAL_REVISION_APPROVED":"PF_TECHNICAL_REVISION_REJECTED",entity:"Product",entityId:String(id),
    details:JSON.stringify({revisionOfId:original.revisionOfId,sku:original.sku,reason,decision:action,requester:original.revisionRequestedBy})}})
   return {productId:updated.id,sku:updated.sku,status:updated.status,revisionNumber:updated.revisionNumber}
  }))
  return NextResponse.json(result,{status:action==="propose"?201:200})
 }catch(e){const message=e instanceof Error?e.message:"UNKNOWN"
  if(message==="NO_TECHNICAL_CHANGE")return error("Aucune modification technique réelle : conserver la référence existante")
  if(message.startsWith("EXISTING_"))return error(`Variante déjà présente : ${message.slice(9)}`)
  if(message.startsWith("SPEC_"))return error(message.slice(5),400)
  if(message==="FOUR_EYES_REQUIRED")return error("Le demandeur ne peut pas approuver sa propre révision",403)
  if(message==="SOURCE_NOT_ACTIVE")return error("Seule une référence active peut être révisée")
  console.error("PF revision",safeErrorMetadata(e));return error("Révision refusée : fiche invalide ou changement concurrent")
 }
}
