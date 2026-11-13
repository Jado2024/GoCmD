import { safeErrorMetadata } from "@/lib/safe-server-error"
import { isValidStockQuantity } from "@/lib/stock-quantity"
import {validTradePolicy,validateSalesSettings} from "@/lib/article-trade"
import {accessGate,currentActor} from "@/lib/access-gate"
import {serializedSQLiteWrite} from "@/lib/sqlite-write"
import {db} from "@/lib/db"
import {NextRequest,NextResponse} from "next/server"
import {z} from "zod"
import { technicalArticleDescription } from "@/lib/article-identity"
import { MATERIAL_CATEGORIES, MATERIAL_UNITS, foamDescriptionFromSpec, type FoamSpec } from "@/lib/material-reference"
export const dynamic="force-dynamic"
const S=z.object({
 name:z.string().trim().min(2).max(180).optional(),description:z.string().trim().max(900).nullable().optional(),
 category:z.enum(MATERIAL_CATEGORIES).optional(),unit:z.enum(MATERIAL_UNITS).optional(),
 unitPrice:z.number().finite().min(0).max(1e9).optional(),
 minStock:z.number().finite().min(0).max(1e9).optional(),
 targetStock:z.number().finite().min(0).max(1e9).nullable().optional(),
 isPurchasable:z.boolean().optional(),isManufactured:z.boolean().optional(),
 isSellable:z.boolean().optional(),isInternalUse:z.boolean().optional(),
 salesUnit:z.enum(MATERIAL_UNITS).optional(),unitsPerSale:z.number().finite().positive().max(1e6).optional(),
 salesUnitPrice:z.number().finite().min(0).max(1e8).optional(),
 location:z.string().trim().max(120).nullable().optional(),
 foamNature:z.enum(["PURE","AGGLO"]).nullable().optional(),
 foamFormat:z.enum(["ROULEAU","PLAQUE","BLOC"]).nullable().optional(),
 foamGrade:z.string().trim().max(80).nullable().optional(),
 foamDensity:z.number().finite().nullable().optional(),
 foamColor:z.string().nullable().optional(),foamFirmness:z.string().nullable().optional(),
 foamResilience:z.number().nullable().optional(),foamSupplierGrade:z.string().nullable().optional(),
 foamLengthCm:z.number().nullable().optional(),foamWidthCm:z.number().nullable().optional(),
 foamHeightCm:z.number().nullable().optional(),foamThicknessCm:z.number().nullable().optional(),
 reason:z.string().trim().min(8).max(500),
})
const identityFields=["foamNature","foamFormat","foamGrade","foamDensity","foamColor","foamFirmness","foamResilience","foamSupplierGrade","foamLengthCm","foamWidthCm","foamHeightCm","foamThicknessCm"] as const
export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){
 const denied=accessGate(req,"buyer");if(denied)return denied
 const id=Number((await ctx.params).id);if(!Number.isSafeInteger(id)||id<=0)return NextResponse.json({error:"Identifiant invalide"},{status:400})
 const parsed=S.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Modification invalide et motif obligatoire"},{status:400})
 const {reason,...changes}=parsed.data;if(!Object.keys(changes).length)return NextResponse.json({error:"Aucun champ modifié"},{status:400})
 try {
  const material=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   const previous=await tx.material.findUnique({where:{id}});if(!previous)throw Error("NOT_FOUND")
   // Interdire les changements silencieux d'identité d'une référence de mousse.
   // En cas de changement de taille, couleur, type, etc., créer un nouvel article.
   if(previous.canonicalIdentity && changes.category!==undefined && changes.category!==previous.category)throw Error("FOAM_IDENTITY_IMMUTABLE")
   if(previous.category==="Mousse" && changes.category!==undefined && changes.category!==previous.category)throw Error("FOAM_IDENTITY_IMMUTABLE")
   if(previous.category!=="Mousse"&&changes.category==="Mousse")throw Error("FOAM_IDENTITY_IMMUTABLE")
   if(previous.category==="Mousse" && identityFields.some(k=>changes[k]!==undefined && (changes[k]??null)!==(previous[k]??null)))throw Error("FOAM_IDENTITY_IMMUTABLE")
   // Les tarifs de vente des matieres revendues ne sont jamais modifies
   // par PATCH : visa directeur via le circuit de proposition dedie.
   if(previous.isSellable && changes.salesUnitPrice!==undefined &&
       Math.abs(changes.salesUnitPrice-previous.salesUnitPrice)>0.00001)throw Error("DIRECTOR_SALES_PRICE_REQUIRED")
   const nextMaterial={...previous,...changes}
   if(!validTradePolicy(nextMaterial,nextMaterial.foamNature,nextMaterial.category))throw Error("INVALID_TRADE_POLICY")
   if(nextMaterial.isSellable && !validateSalesSettings(nextMaterial.unit,nextMaterial.salesUnit??nextMaterial.unit,nextMaterial.unitsPerSale,nextMaterial.salesUnitPrice))throw Error("INVALID_TRADE_SALES")
   if((changes.minStock!==undefined||changes.unit!==undefined)&&!isValidStockQuantity(nextMaterial.minStock,nextMaterial.unit,true))throw Error("INVALID_MIN_STOCK")
   if((nextMaterial.targetStock??nextMaterial.minStock)<nextMaterial.minStock || !isValidStockQuantity(nextMaterial.targetStock??nextMaterial.minStock,nextMaterial.unit,true))throw Error("INVALID_TARGET_STOCK")
   // Les anciennes fiches de démo P5.4 peuvent avoir foamFormat=NULL :
   // la modification du prix/nom reste permise, sans leur inventer une identité.
   if(nextMaterial.category==="Mousse"&&nextMaterial.foamNature==="AGGLO"&&nextMaterial.foamFormat==="ROULEAU")throw Error("FOAM_FORMAT_FORBIDDEN")
   if(nextMaterial.category!=="Mousse"&&(nextMaterial.foamNature||nextMaterial.foamFormat||nextMaterial.foamGrade||nextMaterial.foamDensity))throw Error("FOAM_CHARACTERISTICS_UNEXPECTED")
   if(changes.unit!==undefined&&changes.unit!==previous.unit){
    const [movements,orders,lots]=await Promise.all([tx.movement.count({where:{materialId:id}}),tx.supplierOrderLine.count({where:{materialId:id}}),tx.stockLot.count({where:{materialId:id}})])
    const sales=await tx.orderLine.count({where:{product:{materialId:id}}})
    if(movements||orders||lots||sales||previous.stockQty!==0)throw Error("UNIT_HAS_HISTORY")
   }
   // Le texte reste éditable, mais ne doit jamais retirer les spécifications
   // ni les dimensions d'une fiche de mousse P5.5.
   if(previous.foamIdentityKey && changes.description!==undefined){
     const technical=foamDescriptionFromSpec(previous as unknown as FoamSpec)?.description
     if(technical){
       const free=changes.description?.trim()||''
       changes.description=free&&free.includes(technical)?free:free?`${free.replace(/[.\s]+$/,'')}. Fiche technique : ${technical}`:technical
       if(changes.description.length>900)throw Error('DESCRIPTION_TOO_LONG')
     }
   }
   if(previous.category!=="Mousse" && previous.technicalAttributesJson && changes.description!==undefined){
     const technical=technicalArticleDescription(previous.category,JSON.parse(previous.technicalAttributesJson))
     const free=changes.description?.trim()||""
     changes.description=free&&free.includes(technical)?free:free?`${free.replace(/[.\s]+$/,'')}. Fiche technique : ${technical}`:technical
     if(changes.description.length>900)throw Error("DESCRIPTION_TOO_LONG")
   }
   const linked=await tx.product.findUnique({where:{materialId:id}})
   if(linked && !nextMaterial.isSellable && previous.isSellable){
     const open=await tx.orderLine.count({where:{productId:linked.id,order:{status:{in:["new","production","ready","pending_validation"]}}}})
     if(open)throw Error("TRADE_HAS_OPEN_ORDERS")
   }
   if(linked && (nextMaterial.salesUnit!==previous.salesUnit || nextMaterial.unitsPerSale!==previous.unitsPerSale)){
     const history=await tx.orderLine.count({where:{productId:linked.id}})
     if(history)throw Error("SALES_UNIT_HAS_HISTORY")
   }
   const updated=await tx.material.update({where:{id},data:changes})
   if(nextMaterial.isSellable){
     if(linked)await tx.product.update({where:{id:linked.id},data:{name:updated.name,unit:updated.salesUnit??updated.unit,
       unitPrice:updated.salesUnitPrice,unitsPerSale:updated.unitsPerSale,status:"active"}})
     else await tx.product.create({data:{sku:updated.ref,name:updated.name,family:"NEGOCE",model:updated.ref,variant:"STD",
       length:1,width:1,height:1,unit:updated.salesUnit??updated.unit,unitPrice:updated.salesUnitPrice,
       materialId:updated.id,unitsPerSale:updated.unitsPerSale,status:"active",
       canonicalIdentity:updated.canonicalIdentity,technicalAttributesJson:updated.technicalAttributesJson}})
   }else if(linked)await tx.product.update({where:{id:linked.id},data:{status:"inactive"}})
   await tx.auditEvent.create({data:{actor:currentActor(req)!.username,action:"MATERIAL_UPDATED",entity:"Material",entityId:String(id),details:JSON.stringify({before:{name:previous.name,category:previous.category,unit:previous.unit,unitPrice:previous.unitPrice,minStock:previous.minStock,location:previous.location,foamNature:previous.foamNature,foamFormat:previous.foamFormat,foamGrade:previous.foamGrade,foamDensity:previous.foamDensity},after:changes,reason})}})
   return updated
  }))
  return NextResponse.json(material)
 }catch(e){console.error("[materials:update] erreur:",safeErrorMetadata(e));return NextResponse.json({error:e instanceof Error&&e.message==="DIRECTOR_SALES_PRICE_REQUIRED"?"Tarif de vente catalogue : proposition et visa directeur obligatoires":e instanceof Error&&e.message==="TRADE_HAS_OPEN_ORDERS"?"Désactivation de vente interdite : commandes clients en cours":e instanceof Error&&e.message==="SALES_UNIT_HAS_HISTORY"?"Unité de négoce figée : historique de commandes existant":e instanceof Error&&e.message==="INVALID_TRADE_POLICY"?"Classification article incohérente":e instanceof Error&&e.message==="INVALID_TRADE_SALES"?"Conversion ou prix de vente invalide":e instanceof Error&&e.message==="INVALID_TARGET_STOCK"?"Stock cible insuffisant ou incompatible avec unite":e instanceof Error&&e.message==="INVALID_MIN_STOCK"?"Seuil minimum incompatible avec l’unité de stock":e instanceof Error&&e.message==="UNIT_HAS_HISTORY"?"Unité figée : matière liée à du stock ou à des documents. Créer une nouvelle référence et effectuer une conversion contrôlée.":e instanceof Error&&e.message==="NOT_FOUND"?"Matière introuvable":e instanceof Error&&e.message==="FOAM_FORMAT_FORBIDDEN"?"Mousse agglomérée : rouleau interdit":e instanceof Error&&e.message==="FOAM_IDENTITY_IMMUTABLE"?"Caractéristiques techniques figées : créer une nouvelle référence pour une variante de mousse":e instanceof Error&&e.message==="DESCRIPTION_TOO_LONG"?"Description trop longue une fois la fiche technique ajoutée":"Modification impossible"},{status:409})}
}
