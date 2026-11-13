import { isAuthorizedSupplierQuote } from "@/lib/supplier-quote-authorization"
import { sourceIsValid, type PriceSource } from "@/lib/supplier-price-authorization"
import { isValidPurchaseQuantity } from "@/lib/purchase-quantity"
import { accessGate, currentActor } from "@/lib/access-gate"
import { db } from "@/lib/db"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
const S=z.discriminatedUnion("action",[z.object({action:z.literal("approve")}),z.object({action:z.literal("close"),reason:z.string().trim().min(10).max(500)})])
export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){
 const denied=accessGate(req,"approver");if(denied)return denied
 const actor=currentActor(req)!.username
 const id=Number((await ctx.params).id)
 if(!Number.isSafeInteger(id)||id<=0)return NextResponse.json({error:"BC invalide"},{status:400})
 const parsed=S.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Action invalide ou motif insuffisant"},{status:400})
 try{
  const result=await serializedSQLiteWrite(() => db.$transaction(async tx=>{
   const old=await tx.supplierOrder.findUnique({where:{id}})
   if(!old)throw new Error("NOT_OPEN")
   if(parsed.data.action==="approve"){
    if(old.status!=="draft")throw new Error("NOT_OPEN")
    const supplier=await tx.supplier.findUnique({where:{id:old.supplierId},select:{active:true}})
    if(!supplier?.active)throw new Error("SUPPLIER_SUSPENDED")
    const qual=await tx.supplierQualification.findFirst({where:{supplierId:old.supplierId},orderBy:[{reviewedAt:"desc"},{id:"desc"}]})
    if(!qual||qual.status!=="approved"||(qual.expiresAt&&qual.expiresAt<new Date()))throw new Error("SUPPLIER_NOT_QUALIFIED")
    if(old.createdBy && old.createdBy===actor)throw new Error("SELF_APPROVAL")
    // Revised purchase terms must be approved by someone OTHER than the reviser.
    const lastRevision=await tx.supplierOrderRevision.findFirst({where:{orderId:id},orderBy:[{revision:'desc'},{id:'desc'}]})
    if(lastRevision?.actor===actor)throw new Error("REVISER_SELF_APPROVAL")
    // A draft is not a contractual reservation: re-check DA availability AT approval.
    // In SQLite this runs in the same write transaction as status promotion.
    const lines=await tx.supplierOrderLine.findMany({where:{orderId:id},include:{material:{select:{unit:true}},requestLine:{include:{request:true,supplierOrderLines:{include:{order:true}}}}}})
    if(!lines.length)throw new Error("EMPTY_ORDER")
    for(const line of lines){
     if(!isValidPurchaseQuantity(line.qty,line.material.unit))throw new Error("INVALID_UNIT_QTY")
     if(!Number.isFinite(line.conversionFactor)||line.conversionFactor<=0)throw new Error("INVALID_CONVERSION")
     const supplierMaterial=await tx.supplierMaterial.findUnique({where:{supplierId_materialId:{supplierId:old.supplierId,materialId:line.materialId}}})
     if(!supplierMaterial||Math.abs(supplierMaterial.unitsPerPurchase-line.conversionFactor)>0.000001)throw new Error("INVALID_CONVERSION")
     const purchaseUnit=line.purchaseUnit||line.material.unit
     const purchaseQty=line.purchaseQty??line.qty/line.conversionFactor
     if(!isValidPurchaseQuantity(purchaseQty,purchaseUnit)||Math.abs(purchaseQty*line.conversionFactor-line.qty)>0.000001)throw new Error("INVALID_CONVERSION")
     // P5.11: y compris après révision du BC, recontrôler prix et validité.
     if(!line.priceSourceType||!line.priceSourceId)throw new Error("PRICE_NOT_AUTHORIZED")
     const source:PriceSource|undefined=line.priceSourceType==="CONTRACT"
      ?await tx.supplierPriceAgreement.findUnique({where:{id:line.priceSourceId}}).then(a=>a?({type:"CONTRACT" as const,id:a.id,supplierId:a.supplierId,materialId:a.materialId,unitPrice:Number(a.unitPrice),priceBasis:a.priceBasis,priceBasisFactor:a.priceBasisFactor,sourceUnitPrice:a.sourceUnitPrice===null?null:Number(a.sourceUnitPrice),ref:a.contractRef,validFrom:a.validFrom,validUntil:a.validUntil,approved:a.status==="approved"&&Boolean(a.approvedBy)&&a.createdBy!==a.approvedBy}):undefined)
      :line.priceSourceType==="QUOTE"?await tx.supplierQuoteOffer.findUnique({where:{id:line.priceSourceId},include:{rfq:true,attachments:{select:{id:true,revisionNo:true}}}}).then(q=>q?({type:"QUOTE" as const,id:q.id,supplierId:q.supplierId,materialId:q.rfq.materialId,unitPrice:Number(q.unitPrice),priceBasis:q.priceBasis,priceBasisFactor:q.priceBasisFactor,sourceUnitPrice:q.sourceUnitPrice===null?null:Number(q.sourceUnitPrice),ref:q.quoteRef??"",validUntil:q.validUntil,approved:q.rfq.status==="awarded"&&isAuthorizedSupplierQuote({...q,attachments:q.attachments.filter(a=>a.revisionNo===q.revisionNo)}),requestLineId:q.rfq.requestLineId,offeredQty:q.qty}):undefined):undefined
     if(line.priceSourceType==='QUOTE'&&source){
      const plan=await tx.supplierAwardPlan.findFirst({where:{rfq:{offers:{some:{id:line.priceSourceId!}}},status:'approved'},include:{lines:{where:{offerId:line.priceSourceId!}}}});
      if(plan)source.offeredQty=plan.lines[0]?.qty??0;
     }
     if(!line.requestLineId||!source||!sourceIsValid(source,{supplierId:old.supplierId,materialId:line.materialId,requestLineId:line.requestLineId,qty:line.qty,unitPrice:line.unitPrice,conversionFactor:line.conversionFactor}))throw new Error("PRICE_NOT_AUTHORIZED")
     if(line.priceSourceType==="QUOTE"){
      const siblings=await tx.supplierOrderLine.findMany({where:{priceSourceType:"QUOTE",priceSourceId:line.priceSourceId,orderId:{not:id},order:{status:{in:["draft","confirmed","partial","received"]}}},select:{qty:true}})
      if(siblings.reduce((sum,x)=>sum+x.qty,0)+line.qty>(source.offeredQty??0)+0.000001)throw new Error("QUOTE_QTY_EXCEEDED")
     }
     // P5.15.21 RC (DEF-A-01, contre-audit final) : re-contrôle du plafond
     // d'attribution contractuelle À L'APPROBATION — la révision d'un BC peut
     // sinon porter une ligne CONTRACT au-delà de la quantité décidée en
     // consultation (contournement de CONTRACT_AWARD_REQUIRED de la création).
     // Les lignes de CE BC (encore draft) comptent dans le cumul engagé.
     if(line.priceSourceType==="CONTRACT"){
      const chosen=await tx.supplierAwardContractAllocation.findMany({
        where:{agreementId:line.priceSourceId!,plan:{status:'approved',rfq:{requestLineId:line.requestLineId!}}},
        include:{plan:{select:{decidedBy:true,proposedBy:true}},agreement:{select:{unitPrice:true,status:true}}}
      })
      const approvedAlloc=chosen.filter(a=>a.plan.decidedBy&&a.plan.decidedBy!==a.plan.proposedBy&&a.agreement.status==='approved'&&Math.abs(Number(a.agreement.unitPrice)-line.unitPrice)<=0.0001)
      const allowedQty=approvedAlloc.reduce((n,a)=>n+a.qty,0)
      const used=await tx.supplierOrderLine.findMany({where:{requestLineId:line.requestLineId!,priceSourceType:'CONTRACT',priceSourceId:line.priceSourceId!,order:{status:{in:['draft','confirmed','partial','received','closed']}}},select:{qty:true}})
      if(!approvedAlloc.length||used.reduce((n,l)=>n+l.qty,0)>allowedQty+0.000001)throw new Error("CONTRACT_AWARD_REQUIRED")
     }
     const demand=line.requestLine
     if(!demand||!["approved","partially_approved","ordered","partial"].includes(demand.request.status))throw new Error("DA_NOT_OPEN")
     const otherCommitted=demand.supplierOrderLines.filter(x=>x.orderId!==id && ["confirmed","partial","received"].includes(x.order.status)).reduce((sum,x)=>sum+x.qty,0)
     // Existing accepted quantities from closed orders remain included in demand.receivedQty.
     const receivedFromOpen=demand.supplierOrderLines.filter(x=>x.orderId!==id && ["confirmed","partial","received"].includes(x.order.status)).reduce((sum,x)=>sum+x.receivedQty,0)
     if(line.qty+otherCommitted+demand.receivedQty-receivedFromOpen>demand.approvedQty+0.000001)throw new Error("DA_OVERALLOCATED")
    }
    const changed=await tx.supplierOrder.updateMany({where:{id,status:"draft"},data:{status:"confirmed",approvedBy:actor}})
    if(changed.count!==1)throw new Error("CONFLICT")
    for(const r of await tx.supplierOrderLine.findMany({where:{orderId:id},select:{requestLine:{select:{requestId:true,request:{select:{status:true}}}}}})){
     if(r.requestLine){
      if(!Number.isSafeInteger(r.requestLine.requestId))throw new Error("INVALID_DA_ID")
      if(!["approved","partially_approved","ordered","partial"].includes(r.requestLine.request.status))throw new Error("DA_NOT_OPEN")
      await tx.purchaseRequest.updateMany({where:{id:r.requestLine.requestId,status:{in:["approved","partially_approved"]}},data:{status:"ordered"}})
     }
    }
    await tx.auditEvent.create({data:{actor,action:"SUPPLIER_ORDER_APPROVED",entity:"SupplierOrder",entityId:String(id)}})
    return {id,status:"confirmed"}
   }
   if(!["confirmed","partial"].includes(old.status))throw new Error("NOT_OPEN")
   const changed=await tx.supplierOrder.updateMany({where:{id,status:old.status},data:{status:"closed",closedAt:new Date(),closedReason:`${actor} : ${parsed.data.reason}`}})
   if(changed.count!==1)throw new Error("CONFLICT")
   await tx.auditEvent.create({data:{actor,action:"SUPPLIER_ORDER_CLOSED",entity:"SupplierOrder",entityId:String(id),details:parsed.data.reason}})
   return {id,status:"closed"}
  }))
  return NextResponse.json(result)
 }catch(e){const code=e instanceof Error?e.message:"";return NextResponse.json({error:code==="DA_OVERALLOCATED"?"Quantité déjà affectée à un autre BC approuvé. Réviser le projet de BC.":code==="SUPPLIER_SUSPENDED"?"Fournisseur suspendu : approbation interdite.":code==="INVALID_UNIT_QTY"?"Quantité non conforme à l’unité de stock.":code==="INVALID_CONVERSION"?"Quantité achetée et conversion incohérentes.":code==="SUPPLIER_NOT_QUALIFIED"?"Fournisseur non qualifié : un responsable doit approuver sa qualification.":code==="QUOTE_QTY_EXCEEDED"?"Quantité totale supérieure au devis retenu.":code==="PRICE_NOT_AUTHORIZED"?"Source tarifaire absente, révoquée ou expirée. Recréez un BC avec un devis attribué ou un contrat valide.":code==="SELF_APPROVAL"?"Le créateur ne peut pas approuver son propre BC.":code==="REVISER_SELF_APPROVAL"?"Le dernier révisateur ne peut pas approuver sa propre révision du BC.":code==="CONTRACT_AWARD_REQUIRED"?"Contrat non attribué dans une consultation approuvée ou quantité contractuelle déjà engagée.":"BC non approuvable, clos ou modifié. Actualisez."},{status:409})}
}
