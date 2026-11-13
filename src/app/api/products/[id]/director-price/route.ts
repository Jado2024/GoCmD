import { safeErrorMetadata } from "@/lib/safe-server-error"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { accessGate,hasPermission, currentActor, hasRole, isDirector } from "@/lib/access-gate"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { isExactMADPrice, isSameAuthorizedPrice } from "@/lib/special-price"
import { requireDirectorPriceConfirmation } from "@/lib/sensitive-confirmation"
import { revisePendingPriceSnapshot } from "@/lib/price-snapshot"

export const dynamic="force-dynamic"
const Money=z.number().refine(isExactMADPrice,{message:"Prix en MAD positif, deux décimales maximum"})
const Schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("propose"),unitPrice:Money,reason:z.string().trim().min(8).max(500)}).strict(),
  z.object({action:z.literal("approve"),unitPrice:Money,reason:z.string().trim().min(8).max(500),sensitivePassword:z.string().min(1).max(256).optional()}).strict(),
  z.object({action:z.literal("reject"),reason:z.string().trim().min(8).max(500)}).strict(),
])
const response=(error:string,status:number)=>NextResponse.json({error},{status})
const eq=(a:number,b:number)=>isSameAuthorizedPrice(a,b)

/** Le prix spécial est proposé par ventes, puis autorisé EXCLUSIVEMENT par
 * un directeur nominatif, distinct du demandeur. Aucune validation indirecte. */
export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}){
  const gate=accessGate(req);if(gate)return gate
  const parsed=Schema.safeParse(await req.json().catch(()=>null))
  if(!parsed.success)return response("Décision tarifaire invalide : prix positif et motif de 8 caractères minimum",400)
  const input=parsed.data
  const actor=currentActor(req)!.username
  if(currentActor(req)?.managed && !hasPermission(req,input.action==="propose"?"products.create":"director.prices"))return response("Permission tarifaire refusée",403)
  if(input.action==="propose"?!hasRole(req,"sales"):!isDirector(req))
    return response("Proposition réservée aux commerciaux ; décision réservée au directeur nominatif",403)
  const id=Number((await ctx.params).id)
  if(!Number.isSafeInteger(id)||id<=0)return response("Produit invalide",400)
  if(input.action==="approve"){
    const deniedConfirmation=await requireDirectorPriceConfirmation(req,input.sensitivePassword)
    if(deniedConfirmation)return deniedConfirmation
  }
  try{
    const product=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
      const p=await tx.product.findUnique({where:{id}})
      if(!p)return {error:"Produit introuvable",code:404} as const
      if(!p.specialNotes)return {error:"Cette référence n'est pas un produit spécial",code:409} as const
      if(p.status!=="pending_validation")return {error:"Référence déjà validée ou refusée : créer une nouvelle référence pour changer le tarif",code:409} as const
      const linked=await tx.orderLine.findMany({where:{productId:id},include:{order:true}})
      if(linked.some(l=>l.order.status!=="pending_validation"))
        return {error:"Commande déjà validée : impossible d'en modifier le tarif",code:409} as const
      // Refuser toute mutation si une photographie d'une ligne est absente ou invalide.
      // Sans ceci la ligne affichée et ses documents contractuels pourraient diverger.
      if(linked.some(l=>!l.technicalSnapshotJson || !revisePendingPriceSnapshot(l.technicalSnapshotJson,l.unitPrice,l.technicalSnapshotHash,l.unitPrice).ok))
        return {error:"Snapshot contractuel manquant ou corrompu : tarif non modifiable",code:409} as const
      const reviseLinked=async (unitPrice:number)=>{
        for(const line of linked){
          const revised=revisePendingPriceSnapshot(line.technicalSnapshotJson!,unitPrice,line.technicalSnapshotHash,line.unitPrice)
          if(!revised.ok)throw new Error("INVALID_PRICE_SNAPSHOT")
          await tx.orderLine.update({where:{id:line.id},data:{unitPrice,
            technicalSnapshotJson:revised.json,technicalSnapshotHash:revised.hash,
            ...(line.priceApprovalStatus==="approved"?{priceApprovalStatus:"pending",priceApprovedBy:null,priceApprovedAt:null,priceApprovalReason:null}:{})}})
          await tx.auditEvent.create({data:{actor,action:"ORDER_LINE_PRICE_SNAPSHOT_REVISED",entity:"OrderLine",entityId:String(line.id),
            details:JSON.stringify({orderId:line.orderId,from:line.unitPrice,to:unitPrice,oldHash:line.technicalSnapshotHash,newHash:revised.hash})}})
        }
      }
      if(input.action==="propose"){
        // Un devis, même brouillon, représente déjà un engagement chiffré :
        // pour éviter une altération de son historique on interdit la révision.
        const quotes=await tx.salesQuote.findMany({select:{payload:true}})
        if(quotes.some(q=>{try {return (JSON.parse(q.payload).lines as {productId:number}[]).some(l=>l.productId===id)}catch{return true}}))
          return {error:"Devis lié au produit : conserver le prix ou créer une nouvelle référence spéciale",code:409} as const
        if(p.specialPriceStatus==="pending" && p.specialPriceProposedBy && eq(p.unitPrice,input.unitPrice))
          return {error:"Le prix proposé n'a pas changé",code:409} as const
        const updated=await tx.product.update({where:{id},data:{unitPrice:input.unitPrice,specialPriceStatus:"pending",specialApprovedUnitPrice:null,specialPriceProposedBy:actor,specialPriceApprovedBy:null,specialPriceApprovedAt:null,specialPriceDecisionReason:null,specialPriceRevision:{increment:1}}})
        if(linked.length)await reviseLinked(input.unitPrice)
        await tx.auditEvent.create({data:{actor,action:"SPECIAL_PRICE_PROPOSED",entity:"Product",entityId:String(id),details:JSON.stringify({reason:input.reason,from:p.unitPrice,to:input.unitPrice,previousStatus:p.specialPriceStatus,revision:updated.specialPriceRevision,linkedPendingOrders:linked.map(l=>l.order.ref)})}})
        return updated
      }
      if(p.specialPriceStatus!=="pending")return {error:"Aucune nouvelle proposition tarifaire à décider",code:409} as const
      if(!p.specialPriceProposedBy)return {error:"Proposition nominative manquante : demander au commercial de soumettre le tarif",code:409} as const
      if(p.specialPriceProposedBy===actor)return {error:"Le directeur ne peut pas valider sa propre proposition",code:403} as const
      if(input.action==="reject"){
        const updated=await tx.product.update({where:{id},data:{specialPriceStatus:"rejected",specialPriceDecisionReason:input.reason,specialPriceApprovedBy:null,specialPriceApprovedAt:null,specialApprovedUnitPrice:null}})
        await tx.auditEvent.create({data:{actor,action:"SPECIAL_PRICE_REJECTED",entity:"Product",entityId:String(id),details:JSON.stringify({reason:input.reason,proposed:p.unitPrice,revision:p.specialPriceRevision})}})
        return updated
      }
      const updated=await tx.product.update({where:{id},data:{unitPrice:input.unitPrice,specialPriceStatus:"approved",specialApprovedUnitPrice:input.unitPrice,specialPriceApprovedBy:actor,specialPriceApprovedAt:new Date(),specialPriceDecisionReason:input.reason}})
      // Le prix saisi initialement dans la commande provisoire suit le prix
      // réellement approuvé, avec historique avant/après. Jamais une facture.
      if(linked.length)await reviseLinked(input.unitPrice)
      await tx.auditEvent.create({data:{actor,action:"SPECIAL_PRICE_APPROVED",entity:"Product",entityId:String(id),details:JSON.stringify({reason:input.reason,proposed:p.unitPrice,approved:input.unitPrice,revision:p.specialPriceRevision,linkedPendingOrders:linked.map(l=>l.order.ref)})}})
      return updated
    }))
    if("error" in product)return response(product.error,product.code)
    return NextResponse.json({product})
  }catch(e){console.error("Décision tarif spécial",safeErrorMetadata(e));return response("Conflit d'écriture sur le tarif, actualiser et réessayer",409)}
}
