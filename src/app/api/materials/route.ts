import { safeErrorMetadata } from "@/lib/safe-server-error"
import { isValidStockQuantity } from "@/lib/stock-quantity"
import {validTradePolicy,validateSalesSettings} from "@/lib/article-trade"
import { accessGate, currentActor, canSeeMaterialCosts, hasRole, isDirector } from "@/lib/access-gate"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { technicalArticleIdentity, technicalArticleDescription } from "@/lib/article-identity"
import { MATERIAL_CATEGORIES, MATERIAL_UNITS, foamReferencePrefixFromSpec, nextFoamReference, foamSpecErrors, foamIdentityKey, foamDescriptionFromSpec, type FoamSpec } from "@/lib/material-reference"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = accessGate(req)
  if (denied) return denied

  // V18.9.2 (contre-audit F03) : l'objet matière complet — y compris unitPrice
  // et averageCost — n'est plus renvoyé à tout utilisateur authentifié. DTO
  // explicite : hors rôles achats/approbation/finances/admin, les coûts
  // matières sont remplacés par null (champ présent, valeur masquée).
  const costVisible = canSeeMaterialCosts(req)
  const salesPriceVisible = hasRole(req,"buyer")||isDirector(req)



  const sp = req.nextUrl.searchParams
  const id=Number(sp.get("id")??0)
  if(sp.has("id")&&(!Number.isSafeInteger(id)||id<=0))return NextResponse.json({error:"Identifiant matière invalide"},{status:400})
  const q = (sp.get("q") ?? "").trim()
  const category = sp.get("category") ?? ""
  const status = sp.get("status") ?? "all" // all | out | low | ok
  const order = sp.get("sort") ?? "ref"
  const supplierName = (sp.get("supplier") ?? "").trim()
  const daFilter = sp.get("da") ?? "all"
  const purchasableOnly = sp.get("purchasableOnly")==="1"
  const sharedSupplierIdsRaw = sp.get("sharedSupplierIds") ?? ""
  const sharedSupplierIds = sharedSupplierIdsRaw ? sharedSupplierIdsRaw.split(",").map(Number) : []
  if(!["all","out","low","ok","needs"].includes(status) || !["ref","name","stock","category"].includes(order) ||
     q.length>100 || supplierName.length>120 || !["all","without","active","history"].includes(daFilter) || sharedSupplierIds.length>100 ||
     sharedSupplierIds.some(id=>!Number.isSafeInteger(id)||id<=0))
    return NextResponse.json({error:"Filtres matières invalides"},{status:400})
  // Backward compatible: un appel simple a une première page de 200 lignes.
  // Les écrans catalogue demandent explicitement une taille limitée de 40.
  const pageNumber=Number(sp.get("page")??1)
  const pageSizeNumber=Number(sp.get("pageSize")??200)
  if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>1000000||
     !Number.isSafeInteger(pageSizeNumber)||pageSizeNumber<1||pageSizeNumber>200)
    return NextResponse.json({error:"Pagination matières invalide"},{status:400})
  const page=pageNumber,pageSize=pageSizeNumber
  const stockWhere:Prisma.MaterialWhereInput = status==="out"?{stockQty:{lte:0}}:
    status==="low"?{AND:[{stockQty:{gt:0}},{stockQty:{lt:db.material.fields.minStock}}]}:
    status==="ok"?{AND:[{stockQty:{gt:0}},{stockQty:{gte:db.material.fields.minStock}}]}:
    status==="needs"?{OR:[{stockQty:{lte:0}},{stockQty:{lt:db.material.fields.minStock}}]}:{}
  const where:Prisma.MaterialWhereInput={AND:[
    id?{id}:{},category?{category}:{},stockWhere,
    purchasableOnly?{isPurchasable:true,NOT:[{category:"Mousse",foamNature:"AGGLO"}]}:{},
    daFilter==="history"?{purchaseLines:{some:{}}}:
    daFilter==="active"?{purchaseLines:{some:{request:{status:{in:["pending","approved","partially_approved","ordered","partial"]}}}}}:
    daFilter==="without"?{purchaseLines:{none:{request:{status:{in:["pending","approved","partially_approved","ordered","partial"]}}}}}:{},
    supplierName?{OR:[{supplier:supplierName},{supplierLinks:{some:{supplier:{name:supplierName,active:true}}}}]}:{},
    sharedSupplierIds.length?{supplierLinks:{some:{supplierId:{in:sharedSupplierIds},supplier:{active:true}}}}:{},
    q?{OR:[{ref:{contains:q}},{name:{contains:q}},{supplier:{contains:q}},
      ...(costVisible?[{supplierLinks:{some:{supplierSku:{contains:q}}}}]:[])]}:{}
  ]}
  const orderBy:Prisma.MaterialOrderByWithRelationInput[]=order==="stock"?[{stockQty:"asc"},{id:"asc"}]:
    order==="name"?[{name:"asc"},{id:"asc"}]:
    order==="category"?[{category:"asc"},{name:"asc"},{id:"asc"}]:
    [{category:"asc"},{ref:"asc"},{id:"asc"}]
  const [total,materials,categories]=await Promise.all([
    db.material.count({where}),
    db.material.findMany({where,orderBy,skip:(page-1)*pageSize,take:pageSize,
      include:{supplierLinks:{include:{supplier:{select:{id:true,name:true,active:true}}}}}}),
    db.material.groupBy({by:["category"],orderBy:{category:"asc"}}),
  ])
  return NextResponse.json({
    items: materials.map(({supplierLinks,unitPrice,averageCost,pendingSalesUnitPrice,salesPriceProposedBy,salesPriceProposalReason,salesPriceProposedAt,...rest})=>({
      ...rest,
      pendingSalesUnitPrice:salesPriceVisible?pendingSalesUnitPrice:null,
      salesPriceProposedBy:salesPriceVisible?salesPriceProposedBy:null,
      salesPriceProposalReason:salesPriceVisible?salesPriceProposalReason:null,
      salesPriceProposedAt:salesPriceVisible?salesPriceProposedAt:null,
      unitPrice:costVisible?unitPrice:null,
      averageCost:costVisible?(averageCost==null?null:String(averageCost)):null,
      supplierNames:supplierLinks.filter(x=>x.supplier.active).map(x=>x.supplier.name),
      supplierIds:supplierLinks.filter(x=>x.supplier.active).map(x=>x.supplierId),
      supplierCount:supplierLinks.length,
    })),
    total,page,pageSize,pages:Math.max(1,Math.ceil(total/pageSize)),
    categories:categories.map(item=>item.category),
  },{headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}})

}

const FoamColumns = {
 foamNature:z.enum(["PURE","AGGLO"]).optional(),
 foamFormat:z.enum(["ROULEAU","PLAQUE","BLOC"]).optional(),
 foamGrade:z.string().trim().max(80).optional(),
 foamDensity:z.number().finite().optional(),
 foamColor:z.string().trim().optional(),
 foamFirmness:z.string().trim().nullable().optional(),
 foamResilience:z.number().finite().nullable().optional(),
 foamSupplierGrade:z.string().trim().nullable().optional(),
 foamLengthCm:z.number().finite().nullable().optional(),
 foamWidthCm:z.number().finite().nullable().optional(),
 foamHeightCm:z.number().finite().nullable().optional(),
 foamThicknessCm:z.number().finite().nullable().optional(),
}
const CreateMaterial=z.object({
 ref:z.string().trim().max(160).default(""),
 name:z.string().trim().max(180).default(""),
 description:z.string().trim().max(900).nullable().optional(),
 technicalAttributes:z.record(z.string(),z.union([z.string(),z.number()])).optional(),
 category:z.enum(MATERIAL_CATEGORIES),unit:z.enum(MATERIAL_UNITS),
 unitPrice:z.number().finite().min(0).max(1e9),
 minStock:z.number().finite().min(0).max(1e9).default(0),
 targetStock:z.number().finite().min(0).max(1e9).nullable().optional(),
 isPurchasable:z.boolean().default(true),isManufactured:z.boolean().default(false),
 isSellable:z.boolean().default(false),isInternalUse:z.boolean().default(true),
 salesUnit:z.enum(MATERIAL_UNITS).optional(),unitsPerSale:z.number().finite().positive().max(1e6).default(1),
 salesUnitPrice:z.number().finite().min(0).max(1e8).default(0),
 location:z.string().trim().max(120).optional(),
 ...FoamColumns,
})
const foamKeys=Object.keys(FoamColumns) as (keyof typeof FoamColumns)[]

export async function POST(req:NextRequest){
 const denied=accessGate(req,"buyer");if(denied)return denied
 const parsed=CreateMaterial.safeParse(await req.json().catch(()=>null))
 if(!parsed.success)return NextResponse.json({error:"Fiche matière invalide",details:parsed.error.flatten()},{status:400})
 const data=parsed.data
 if((data.targetStock??data.minStock)<data.minStock || (data.targetStock!==undefined&&data.targetStock!==null&&!isValidStockQuantity(data.targetStock,data.unit,true)))return NextResponse.json({error:"Stock cible inferieur au minimum ou incompatible avec unite"},{status:400})
 if(!isValidStockQuantity(data.minStock,data.unit,true))return NextResponse.json({error:"Seuil minimum incompatible avec l’unité de stock"},{status:400})
 const flags={isPurchasable:data.isPurchasable,isManufactured:data.isManufactured,isSellable:data.isSellable,isInternalUse:data.isInternalUse}
 if(!validTradePolicy(flags,data.foamNature,data.category))return NextResponse.json({error:"Classification incohérente : fabrication/achat et destination requis ; mousse AGGLO non achetable"},{status:400})
 const salesUnit=data.salesUnit??data.unit
 if(data.isSellable && !validateSalesSettings(data.unit,salesUnit,data.unitsPerSale,data.salesUnitPrice))return NextResponse.json({error:"Unité, conversion ou prix de vente invalide"},{status:400})
 const isFoam=data.category==="Mousse"
 if(!isFoam && foamKeys.some(k=>data[k]!=null && data[k]!==""))
   return NextResponse.json({error:"Les caractéristiques mousse sont réservées à la catégorie Mousse"},{status:400})
 if(!isFoam && data.name.length<2)
   return NextResponse.json({error:"Désignation obligatoire pour une matière"},{status:400})
 const identityNonFoam=!isFoam?technicalArticleIdentity(data.category,data.technicalAttributes??{}):null
 if(identityNonFoam?.errors.length)return NextResponse.json({error:"Dictionnaire technique incomplet",details:identityNonFoam.errors},{status:400})
 if(!isFoam && data.ref && data.ref!==identityNonFoam?.reference)
   return NextResponse.json({error:"Référence non conforme à la variante technique proposée"},{status:400})
 // Conserver la protection historique : mousse agglomérée jamais en rouleau.
 if(data.category==="Mousse"&&parsed.data.foamNature==="AGGLO"&&parsed.data.foamFormat==="ROULEAU")
   return NextResponse.json({error:"Mousse agglomérée : rouleau interdit"},{status:400})
 const spec:FoamSpec|null=isFoam?{
   foamNature:data.foamNature??"",foamFormat:data.foamFormat??"",foamGrade:data.foamGrade??"",
   foamDensity:data.foamDensity??0,foamColor:data.foamColor??"",
   foamFirmness:data.foamFirmness||null,foamResilience:data.foamResilience??null,
   foamSupplierGrade:data.foamSupplierGrade||null,
   foamLengthCm:data.foamLengthCm??null,foamWidthCm:data.foamWidthCm??null,
   foamHeightCm:data.foamHeightCm??null,foamThicknessCm:data.foamThicknessCm??null,
 }:null
 if(spec){
  const errors=foamSpecErrors(spec)
  if(errors.length)return NextResponse.json({error:"Caractéristiques mousse invalides",details:errors},{status:400})
 }
 const canonical=spec?foamIdentityKey(spec):null
 const proposal=spec?foamDescriptionFromSpec(spec):null
 const name=data.name.trim()||proposal?.name||""
 let description=data.description?.trim()||proposal?.description||null
 // Toujours conserver les caractéristiques et les dimensions, même si le texte
 // descriptif est personnalisé : ajout d'une fiche technique générée.
 if(spec&&proposal&&description&&!description.includes(proposal.description))
   description=`${description.replace(/[.\s]+$/,'')}. Fiche technique : ${proposal.description}`
 if(identityNonFoam && !identityNonFoam.errors.length){
   const technical=technicalArticleDescription(data.category,identityNonFoam.attributes)
   description=description?`${description.replace(/[.\s]+$/,'')}. Fiche technique : ${technical}`:technical
 }
 if(name.length<2||name.length>180|| (description&&description.length>900))
  return NextResponse.json({error:"Nom ou description invalide"},{status:400})
 if(data.ref && !/^[a-z0-9][a-z0-9_-]{1,159}$/i.test(data.ref))
  return NextResponse.json({error:"Référence : lettres, chiffres, tirets et underscores uniquement"},{status:400})
 // Personnalisation du suffixe autorisée, mais pas suppression des attributs
 // techniques et des dimensions constituant le préfixe obligatoire.
 if(spec && data.ref && !data.ref.toUpperCase().startsWith(foamReferencePrefixFromSpec(spec)!+'-'))
  return NextResponse.json({error:"Référence personnalisée : conserver le préfixe technique et les dimensions ; seul le suffixe est personnalisable"},{status:400})
 try {
  const created=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   let ref=data.ref
   const existing=await tx.material.findMany({select:{ref:true,foamIdentityKey:true,canonicalIdentity:true}})
   const identity=spec?JSON.stringify({schema:"GOCMD-ARTICLE-V2",family:"MOU",foam:canonical}):identityNonFoam!.identity
   if(existing.some(m=>m.canonicalIdentity===identity))throw Error("DUPLICATE_ARTICLE_IDENTITY")
   if(canonical && existing.some(m=>m.foamIdentityKey===canonical))throw Error("DUPLICATE_FOAM_VARIANT")
   if(!ref){
     if(spec){
       const prefix=foamReferencePrefixFromSpec(spec)
       if(!prefix)throw Error("INVALID_FOAM_REFERENCE")
       ref=nextFoamReference(prefix,existing.map(m=>m.ref))
     }else ref=identityNonFoam!.reference!
   }
   if(existing.some(m=>m.ref.toLocaleUpperCase("fr")===ref.toLocaleUpperCase("fr")))throw Error("DUPLICATE_REF")
   const {technicalAttributes:clientAttributes,...standardData}=data
   void clientAttributes
   const material=await tx.material.create({data:{...standardData,name,description,ref,foamIdentityKey:canonical,
     canonicalIdentity:identity,technicalAttributesJson:JSON.stringify(spec??identityNonFoam?.attributes),
     stockQty:0,salesUnit}})
   // Une référence physique traverse MP et PF : collisions non liées refusées.
   const skuCollision=await tx.product.findFirst({where:{sku:ref}})
   if(skuCollision)throw Error("DUPLICATE_REF_GLOBAL")
   if(data.isSellable){
     // Le SKU commercial reprend la référence métier de la matière : aucun stock en double.
     await tx.product.create({data:{sku:ref,name,family:"NEGOCE",model:ref,variant:"STD",length:1,width:1,height:1,
       unit:salesUnit,unitPrice:data.salesUnitPrice,status:"active",materialId:material.id,unitsPerSale:data.unitsPerSale,
       canonicalIdentity:identity,technicalAttributesJson:material.technicalAttributesJson}})
   }
   await tx.auditEvent.create({data:{actor:currentActor(req)!.username,action:"MATERIAL_CREATED",entity:"Material",entityId:String(material.id),details:JSON.stringify({ref:material.ref,foamIdentityKey:canonical})}})
   return material
  }))
  return NextResponse.json(created,{status:201})
 }catch(e){
  if(e instanceof Error&&e.message==="DUPLICATE_ARTICLE_IDENTITY")return NextResponse.json({error:"Cet article physique existe déjà : rechercher la fiche plutôt que créer un doublon",code:"DUPLICATE_ARTICLE_IDENTITY"},{status:409})
  if(e instanceof Error&&e.message==="DUPLICATE_REF_GLOBAL")return NextResponse.json({error:"Référence déjà utilisée par un autre produit ou matière",code:"DUPLICATE_REF_GLOBAL"},{status:409})
  if(e instanceof Error&&e.message==="DUPLICATE_FOAM_VARIANT")return NextResponse.json({error:"Une mousse avec ces caractéristiques existe déjà : rechercher la fiche avant de créer un doublon",code:"DUPLICATE_FOAM_VARIANT"},{status:409})
  if(e instanceof Error&&e.message==="DUPLICATE_REF")return NextResponse.json({error:"Cette référence existe déjà",code:"DUPLICATE_REF"},{status:409})
  console.error("[materials:create] erreur:",safeErrorMetadata(e))
  return NextResponse.json({error:"Référence matière existante ou création impossible"},{status:409})
 }
}
