import { accessGate, currentActor, canSeeMaterialCosts, hasPermission } from "@/lib/access-gate"
import { db } from "@/lib/db"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { supplierLinkForReader } from "@/lib/supplier-link-visibility"
import { approvedSupplierExceptionKey, normalizeSupplierSku, supplierLookupKey } from "@/lib/supplier-sku-identity"
import { safeErrorMetadata } from "@/lib/safe-server-error"

export const dynamic = "force-dynamic"

// Fiche fournisseur : coordonnées et mentions administratives facultatives.
// Ne pas stocker d'informations bancaires dans cette fiche.
const SupplierFields = z.object({
 name:z.string().trim().min(2).max(120),
 phone:z.string().trim().max(40).optional(),
 email:z.union([z.email(),z.literal("")]).optional(),
 address:z.string().trim().max(300).optional(),
 city:z.string().trim().max(100).optional(),
 country:z.string().trim().max(100).optional(),
 ice:z.string().trim().max(40).optional(),
 taxId:z.string().trim().max(40).optional(),
 tradeRegister:z.string().trim().max(80).optional(),
 paymentTerms:z.string().trim().max(180).optional(),
})
const SupplierPatch = SupplierFields.partial().extend({supplierId:z.number().int().positive(),active:z.boolean().optional()})
const LinkInput = z.object({
 action:z.literal("link"),supplierId:z.number().int().positive(),materialId:z.number().int().positive(),
 supplierSku:z.string().trim().max(80).optional(),unitPrice:z.number().finite().min(0).max(1_000_000_000).nullable().optional(),
 leadTimeDays:z.number().int().min(0).max(365).nullable().optional(),preferred:z.boolean().default(false),
 purchaseUnit:z.string().trim().min(1).max(20).optional(),unitsPerPurchase:z.number().finite().positive().max(1_000_000).optional(),
})
const ExceptionRequest=z.object({action:z.literal("request-sku-exception"),supplierId:z.number().int().positive(),materialId:z.number().int().positive(),supplierSku:z.string().trim().min(1).max(80),reason:z.string().trim().min(12).max(500)})
const ExceptionApproval=z.object({action:z.literal("approve-sku-exception"),requestId:z.number().int().positive(),reason:z.string().trim().min(12).max(500)})
const optionalText=(s:string|undefined)=>s?.trim()||null
const duplicateName=(items:{id:number;name:string}[],name:string,except?:number)=>items.some(s=>s.id!==except&&s.name.trim().normalize("NFKC").toLocaleLowerCase("fr")===name.trim().normalize("NFKC").toLocaleLowerCase("fr"))

export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 if(req.nextUrl.searchParams.get("view")==="choices"){
  const items=await db.supplier.findMany({select:{id:true,name:true,active:true},orderBy:[{name:"asc"},{id:"asc"}]})
  return NextResponse.json({items})
 }

 const pricing=canSeeMaterialCosts(req)
 const [items,materials,history]=await Promise.all([
  db.supplier.findMany({include:{
   materials:{include:{material:{select:{id:true,ref:true,name:true,category:true,unit:true}}}},
   qualifications:{select:{status:true,expiresAt:true},orderBy:[{reviewedAt:"desc"},{id:"desc"}],take:1}
  },orderBy:{name:"asc"}}),
  db.material.findMany({select:{id:true,ref:true,name:true,category:true,unit:true},orderBy:{name:"asc"}}),
  pricing?db.auditEvent.findMany({where:{entity:"SupplierMaterial",action:{in:["SUPPLIER_MATERIAL_LINKED","SUPPLIER_MATERIAL_UPDATED","SUPPLIER_SKU_EXCEPTION_REQUESTED","SUPPLIER_SKU_EXCEPTION_APPROVED"]}},select:{id:true,actor:true,action:true,entityId:true,details:true,createdAt:true},orderBy:{createdAt:"desc"},take:300}):Promise.resolve([]),
 ])
 const sanitised=items.map(s=>({
  id:s.id,code:s.code,name:s.name,active:s.active,
  qualificationStatus:!s.active?"suspended":!s.qualifications.length?"pending":
   s.qualifications[0].status==="approved"&&s.qualifications[0].expiresAt&&s.qualifications[0].expiresAt<new Date()
    ?"expired":s.qualifications[0].status,
  qualificationExpiresAt:s.qualifications[0]?.expiresAt?.toISOString()??null,
  phone:pricing?s.phone:null,email:pricing?s.email:null,address:pricing?s.address:null,
  city:pricing?s.city:null,country:pricing?s.country:null,ice:pricing?s.ice:null,
  taxId:pricing?s.taxId:null,tradeRegister:pricing?s.tradeRegister:null,paymentTerms:pricing?s.paymentTerms:null,
  materials:s.materials.map(l=>({
   id:l.id,materialId:l.materialId,supplierId:l.supplierId,material:l.material,
   // Une référence de sourcing n'est pas une donnée publique du catalogue.
   // Même si le prix est masqué, ne pas livrer le code fournisseur sans coûts.read.
   supplierSku:pricing?l.supplierSku:null,unitPrice:pricing?l.unitPrice:null,leadTimeDays:l.leadTimeDays,
   preferred:l.preferred,purchaseUnit:l.purchaseUnit,unitsPerPurchase:l.unitsPerPurchase,
   skuExceptionApprovedBy:l.supplierSkuExceptionApprovedBy,skuExceptionReason:pricing?l.supplierSkuExceptionReason:null,
  })),
 }))
 return NextResponse.json({items:sanitised,materials,history})
}

export async function POST(req:NextRequest){
 const raw=await req.json().catch(()=>null)
 // Exception: acheteur propose, responsable approbateur DISTINCT accepte.
 // L'enregistrement n'effectue aucun référencement tant que le visa manque.
 if(raw?.action==="approve-sku-exception"){
  const denied=accessGate(req,"approver");if(denied)return denied
  if(currentActor(req)?.managed&&!hasPermission(req,"purchases.approve"))
    return NextResponse.json({error:"Permission d'approbation achats désactivée"},{status:403})
  const actor=currentActor(req)!.username
  const parsed=ExceptionApproval.safeParse(raw)
  if(!parsed.success)return NextResponse.json({error:"Visa fournisseur invalide"},{status:400})
  try{
   const link=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
    const request=await tx.auditEvent.findUnique({where:{id:parsed.data.requestId}})
    if(!request||request.action!=="SUPPLIER_SKU_EXCEPTION_REQUESTED"||request.entity!=="SupplierMaterial")throw Error("INVALID_REQUEST")
    if(request.actor===actor)throw Error("FOUR_EYES_REQUIRED")
    const processed=await tx.auditEvent.findMany({where:{action:"SUPPLIER_SKU_EXCEPTION_APPROVED",entity:"SupplierMaterial",entityId:request.entityId},select:{details:true}})
    if(processed.some(x=>{try{return JSON.parse(x.details??"{}").requestId===request.id}catch{return false}}))throw Error("ALREADY_APPROVED")
    const requested=ExceptionRequest.parse(JSON.parse(request.details??"{}"))
    const [supplier,material]=await Promise.all([tx.supplier.findUnique({where:{id:requested.supplierId}}),tx.material.findUnique({where:{id:requested.materialId}})])
    if(!supplier?.active||!material)throw Error("SOURCE_CHANGED")
    const options=await tx.supplierMaterial.findMany({where:{supplierId:requested.supplierId,supplierSku:{not:null}}})
    const collision=options.filter(x=>x.materialId!==requested.materialId&&normalizeSupplierSku(x.supplierSku)===normalizeSupplierSku(requested.supplierSku))
    if(!collision.length)throw Error("NO_COLLISION")
    const original=await tx.supplierMaterial.findUnique({where:{supplierId_materialId:{supplierId:requested.supplierId,materialId:requested.materialId}}})
    if(original?.supplierSku && normalizeSupplierSku(original.supplierSku)!==normalizeSupplierSku(requested.supplierSku))throw Error("SOURCE_CHANGED")
    const link=await tx.supplierMaterial.upsert({where:{supplierId_materialId:{supplierId:requested.supplierId,materialId:requested.materialId}},
     create:{supplierId:requested.supplierId,materialId:requested.materialId,supplierSku:requested.supplierSku,
      supplierLookupKey:approvedSupplierExceptionKey(requested.supplierId,requested.supplierSku,requested.materialId),
      supplierSkuExceptionApprovedBy:actor,supplierSkuExceptionReason:`${requested.reason} | Visa : ${parsed.data.reason}`,
      preferred:false,purchaseUnit:material.unit,unitsPerPurchase:1},
     update:{supplierSku:requested.supplierSku,
      supplierLookupKey:approvedSupplierExceptionKey(requested.supplierId,requested.supplierSku,requested.materialId),
      supplierSkuExceptionApprovedBy:actor,supplierSkuExceptionReason:`${requested.reason} | Visa : ${parsed.data.reason}`,preferred:false}})
    await tx.auditEvent.create({data:{actor,action:"SUPPLIER_SKU_EXCEPTION_APPROVED",entity:"SupplierMaterial",entityId:request.entityId,
     details:JSON.stringify({requestId:request.id,supplierId:requested.supplierId,materialId:requested.materialId,supplierSku:requested.supplierSku,
      conflictingMaterialIds:collision.map(x=>x.materialId),reason:parsed.data.reason,requestedBy:request.actor})}})
    return link
   }))
   return NextResponse.json({link:supplierLinkForReader(link,canSeeMaterialCosts(req))},{status:201})
  }catch(e){console.error("Référencement exceptionnel refusé",safeErrorMetadata(e))
   return NextResponse.json({error:"Visa refusé : demande déjà traitée, conflit résolu, acteurs identiques ou données modifiées"},{status:409})}
 }
 const denied=accessGate(req,"buyer");if(denied)return denied
 if(currentActor(req)?.managed&&!hasPermission(req,"suppliers.manage"))
   return NextResponse.json({error:"Gestion des fournisseurs non autorisée"},{status:403})
 const actor=currentActor(req)!.username
 if(raw?.action==="request-sku-exception"){
  const parsed=ExceptionRequest.safeParse(raw)
  if(!parsed.success)return NextResponse.json({error:"Renseigner fournisseur, matière, code et justification de 12 caractères"},{status:400})
  const d=parsed.data
  try{
   const request=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
    const supplier=await tx.supplier.findUnique({where:{id:d.supplierId}}),material=await tx.material.findUnique({where:{id:d.materialId}})
    if(!supplier?.active||!material)throw Error("NOT_FOUND")
    const options=await tx.supplierMaterial.findMany({where:{supplierId:d.supplierId,supplierSku:{not:null}}})
    const conflicts=options.filter(x=>x.materialId!==d.materialId&&normalizeSupplierSku(x.supplierSku)===normalizeSupplierSku(d.supplierSku))
    if(!conflicts.length)throw Error("NO_COLLISION")
    const request=await tx.auditEvent.create({data:{actor,action:"SUPPLIER_SKU_EXCEPTION_REQUESTED",entity:"SupplierMaterial",entityId:`${d.supplierId}:${d.materialId}`,
     details:JSON.stringify({...d,conflictingMaterialIds:conflicts.map(x=>x.materialId)})}})
    return {id:request.id,conflictingMaterialIds:conflicts.map(x=>x.materialId)}
   }))
   return NextResponse.json({request},{status:201})
  }catch{return NextResponse.json({error:"Aucun conflit de référence à justifier, ou fournisseur/matière indisponible"},{status:409})}
 }
 if(raw?.action==="link"){
  const parsed=LinkInput.safeParse(raw)
  if(!parsed.success)return NextResponse.json({error:"Référencement matière–fournisseur invalide"},{status:400})
  const d=parsed.data
  if(d.unitPrice!==undefined&&!canSeeMaterialCosts(req))return NextResponse.json({error:"Accès aux tarifs non autorisé"},{status:403})
  try{
   const link=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
    const [supplier,material]=await Promise.all([
     tx.supplier.findUnique({where:{id:d.supplierId}}),tx.material.findUnique({where:{id:d.materialId}}),
    ])
    if(!supplier||!material)throw new Error("NOT_FOUND")
    if(!supplier.active)throw new Error("INACTIVE")
    if(d.preferred)await tx.supplierMaterial.updateMany({where:{materialId:d.materialId},data:{preferred:false}})
    const current=await tx.supplierMaterial.findUnique({where:{supplierId_materialId:{supplierId:d.supplierId,materialId:d.materialId}}})
    const nextSku=d.supplierSku===undefined?current?.supplierSku??null:optionalText(d.supplierSku)
    const lookup=supplierLookupKey(d.supplierId,nextSku)
    // Include approved exceptions: their unique key is intentionally suffixed,
    // but their ORIGINAL reference is still ambiguous and needs explicit review.
    const options=lookup?await tx.supplierMaterial.findMany({where:{supplierId:d.supplierId,supplierSku:{not:null}}}):[]
    const collision=options.find(x=>x.materialId!==d.materialId&&normalizeSupplierSku(x.supplierSku)===normalizeSupplierSku(nextSku))
    if(collision)throw Error("SUPPLIER_SKU_COLLISION")
    // Conserver l'unité de conversion et le SKU actuels quand le formulaire ne les fournit pas.
    const link=await tx.supplierMaterial.upsert({
     where:{supplierId_materialId:{supplierId:d.supplierId,materialId:d.materialId}},
     update:{supplierSku:nextSku,supplierLookupKey:lookup,
      supplierSkuExceptionApprovedBy:null,supplierSkuExceptionReason:null,
      unitPrice:d.unitPrice===undefined?current?.unitPrice??null:d.unitPrice,
      leadTimeDays:d.leadTimeDays===undefined?current?.leadTimeDays??null:d.leadTimeDays,
      preferred:d.preferred,purchaseUnit:d.purchaseUnit??current?.purchaseUnit??material.unit,
      unitsPerPurchase:d.unitsPerPurchase??current?.unitsPerPurchase??1},
     create:{supplierId:d.supplierId,materialId:d.materialId,supplierSku:nextSku,supplierLookupKey:lookup,
      unitPrice:d.unitPrice??null,leadTimeDays:d.leadTimeDays??null,preferred:d.preferred,
      purchaseUnit:d.purchaseUnit??material.unit,unitsPerPurchase:d.unitsPerPurchase??1},
    })
    await tx.auditEvent.create({data:{actor,action:current?"SUPPLIER_MATERIAL_UPDATED":"SUPPLIER_MATERIAL_LINKED",entity:"SupplierMaterial",entityId:`${d.supplierId}:${d.materialId}`,
     details:JSON.stringify({supplierId:d.supplierId,materialRef:material.ref,supplierSku:link.supplierSku,unitPrice:link.unitPrice,leadTimeDays:link.leadTimeDays,preferred:link.preferred,purchaseUnit:link.purchaseUnit,unitsPerPurchase:link.unitsPerPurchase})}})
    return link
   }))
   // Le droit de REFERENCER une MP ne donne pas le droit de voir son tarif.
   // Ne jamais renvoyer le prix historique par l’upsert si costs.read est refusé.
   const visibleLink=supplierLinkForReader(link,canSeeMaterialCosts(req))
   return NextResponse.json({link:visibleLink},{status:201,headers:{"Cache-Control":"private, no-store"}})
  }catch(e){
   const error=e instanceof Error?e.message:""
   return NextResponse.json({error:error==="SUPPLIER_SKU_COLLISION"?"Cette référence fournisseur désigne déjà une autre matière chez ce fournisseur ; demander une exception validée au responsable Achats":error==="INACTIVE"?"Réactiver ce fournisseur avant de le référencer":"Association impossible : fournisseur ou matière introuvable"},{status:409})
  }
 }
 const parsed=SupplierFields.safeParse(raw)
 if(!parsed.success)return NextResponse.json({error:"Fiche fournisseur invalide : vérifiez les champs"},{status:400})
 try{
  const supplier=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   const names=await tx.supplier.findMany({select:{id:true,name:true}})
   if(duplicateName(names,parsed.data.name))throw new Error("DUPLICATE")
   const code=`FRN-${randomUUID().replace(/-/g,"").slice(0,16).toUpperCase()}`
   const d=parsed.data
   const created=await tx.supplier.create({data:{code,name:d.name,phone:optionalText(d.phone),email:optionalText(d.email),address:optionalText(d.address),city:optionalText(d.city),country:optionalText(d.country),ice:optionalText(d.ice),taxId:optionalText(d.taxId),tradeRegister:optionalText(d.tradeRegister),paymentTerms:optionalText(d.paymentTerms)}})
   await tx.auditEvent.create({data:{actor,action:"SUPPLIER_CREATED",entity:"Supplier",entityId:String(created.id),details:JSON.stringify({code:created.code,name:created.name})}})
   return created
  }))
  return NextResponse.json({supplier},{status:201})
 }catch(e){
  const error=e instanceof Error?e.message:""
  return NextResponse.json({error:error==="DUPLICATE"?"Ce fournisseur existe déjà":"Création impossible : vérifiez les informations"},{status:409})
 }
}

export async function PATCH(req:NextRequest){
 const denied=accessGate(req,"buyer");if(denied)return denied
 const actor=currentActor(req)!.username
 const parsed=SupplierPatch.safeParse(await req.json().catch(()=>null))
 if(!parsed.success)return NextResponse.json({error:"Modification fournisseur invalide"},{status:400})
 const {supplierId,...changes}=parsed.data
 if(!Object.keys(changes).length)return NextResponse.json({error:"Aucune modification"},{status:400})
 try{
  const supplier=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   const old=await tx.supplier.findUnique({where:{id:supplierId}})
   if(!old)throw new Error("NOT_FOUND")
   if(changes.name!==undefined){
    const names=await tx.supplier.findMany({select:{id:true,name:true}})
    if(duplicateName(names,changes.name,supplierId))throw new Error("DUPLICATE")
   }
   const updated=await tx.supplier.update({where:{id:supplierId},data:{
    name:changes.name,phone:changes.phone===undefined?undefined:optionalText(changes.phone),
    email:changes.email===undefined?undefined:optionalText(changes.email),
    address:changes.address===undefined?undefined:optionalText(changes.address),
    city:changes.city===undefined?undefined:optionalText(changes.city),
    country:changes.country===undefined?undefined:optionalText(changes.country),
    ice:changes.ice===undefined?undefined:optionalText(changes.ice),
    taxId:changes.taxId===undefined?undefined:optionalText(changes.taxId),
    tradeRegister:changes.tradeRegister===undefined?undefined:optionalText(changes.tradeRegister),
    paymentTerms:changes.paymentTerms===undefined?undefined:optionalText(changes.paymentTerms),
    active:changes.active,
   }})
   // Un fournisseur suspendu ne doit plus être proposé comme favori.
   if(changes.active===false)await tx.supplierMaterial.updateMany({where:{supplierId},data:{preferred:false}})
   const modified=Object.keys(changes).filter(k=>JSON.stringify(old[k as keyof typeof old])!==JSON.stringify(updated[k as keyof typeof updated]))
   await tx.auditEvent.create({data:{actor,action:"SUPPLIER_UPDATED",entity:"Supplier",entityId:String(supplierId),details:JSON.stringify({code:old.code,fields:modified,active:updated.active})}})
   return updated
  }))
  return NextResponse.json({supplier})
 }catch(e){
  const error=e instanceof Error?e.message:""
  const message=error==="NOT_FOUND"?"Fournisseur introuvable":error==="DUPLICATE"?"Ce nom est déjà utilisé":"Modification impossible"
  return NextResponse.json({error:message},{status:error==="NOT_FOUND"?404:409})
 }
}
