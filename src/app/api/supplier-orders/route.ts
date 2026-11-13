import { Prisma } from "@prisma/client"
import {readDocumentPage,documentPagination} from "@/lib/document-register"
import { isAuthorizedSupplierQuote } from "@/lib/supplier-quote-authorization"
import { sourceIsValid, type PriceSource } from "@/lib/supplier-price-authorization"
import { isValidPurchaseQuantity } from "@/lib/purchase-quantity"
import { remainingToOrder } from "@/lib/purchase-availability"
import { validPriceSourceConversion } from "@/lib/supplier-source-unit"
import { nextRef } from "@/lib/erp-server"
import { accessGate, currentActor, canSeeMaterialCosts } from "@/lib/access-gate"
import { db } from "@/lib/db"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

export const dynamic = "force-dynamic"
const S = z.object({supplierId:z.number().int().positive(),expectedDate:z.string().optional(),note:z.string().trim().max(500).optional(),lines:z.array(z.object({requestLineId:z.number().int().positive(),qty:z.number().finite().positive().max(1_000_000),unitPrice:z.number().finite().min(0).max(1_000_000_000),sourceType:z.enum(["CONTRACT","QUOTE"]),sourceId:z.number().int().positive(),purchaseQty:z.number().finite().positive().optional()})).min(1).max(100)})
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 // V18.9.1 (contre-audit A-09) : tarifs fournisseurs masqués hors rôles
 // achats / approbation / finances / admin (quantités et statuts conservés
 // pour la réception et la traçabilité).
 // V18.9.2 (contre-audit F03) : le masquage couvre aussi les objets IMBRIQUÉS
 // renvoyés par cette route — la matière de chaque ligne (unitPrice,
 // averageCost) et la ligne de demande d'achat (unitPrice) — et non plus le
 // seul prix de la ligne de BC. Sélect Prisma minimal : la matière est
 // projetée champ par champ, jamais « include:true » intégral.
 const pricing=canSeeMaterialCosts(req)
 const materialSelect={id:true,ref:true,name:true,category:true,unit:true,foamNature:true,foamGrade:true,foamDensity:true,location:true,supplier:true,unitPrice:pricing,averageCost:pricing} as const
 const params=req.nextUrl.searchParams
 const register=params.get("view")==="register"
 const receivable=params.get("view")==="receivable"
 const {page,pageSize,q,skip,take}=readDocumentPage(params,40)
 const status=params.get("status")
 const where:Prisma.SupplierOrderWhereInput={
  ...(receivable?{status:{in:["confirmed","partial"]}}:{}),
  ...(register&&status&&["draft","confirmed","partial","received","closed"].includes(status)?{status}:{}),
  ...((register||receivable)&&q?{OR:[{ref:{contains:q}},{supplier:{name:{contains:q}}},{lines:{some:{OR:[{material:{name:{contains:q}}},{material:{ref:{contains:q}}},{requestLine:{request:{ref:{contains:q}}}}]}}}]}:{}),
 }
 const dir=params.get("dir")==="asc"?"asc":"desc"
 const sort=params.get("sort")
 const orderBy:Prisma.SupplierOrderOrderByWithRelationInput[]=
  register&&sort==="ref"?[{ref:dir},{id:"desc"}]:
  (register&&sort==="date")||receivable?[{expectedDate:{sort:dir,nulls:"last"}},{createdAt:dir},{id:"desc"}]:
  [{createdAt:"desc"},{id:"desc"}]
 const legacyTake=Math.min(200,Math.max(1,Math.trunc(Number(params.get("take")??100)||100)))
 const legacySkip=Math.min(1000000,Math.max(0,Math.trunc(Number(params.get("skip")??0)||0)))
 // A sort on prices is allowed only when the account can read them.
 const amountSort=register&&pricing&&sort==="montant"
 const amountIds=amountSort?await db.$queryRaw<{id:number}[]>(Prisma.sql`
   SELECT b.id FROM SupplierOrder b JOIN Supplier s ON s.id=b.supplierId
   WHERE (${status??"all"} NOT IN ('draft','confirmed','partial','received','closed') OR b.status=${status??""})
   AND (${q}='' OR b.ref LIKE '%'||${q}||'%' OR s.name LIKE '%'||${q}||'%' OR EXISTS (
     SELECT 1 FROM SupplierOrderLine l JOIN Material m ON m.id=l.materialId
     LEFT JOIN PurchaseRequestLine dl ON dl.id=l.requestLineId LEFT JOIN PurchaseRequest da ON da.id=dl.requestId
     WHERE l.orderId=b.id AND (m.name LIKE '%'||${q}||'%' OR m.ref LIKE '%'||${q}||'%' OR da.ref LIKE '%'||${q}||'%')
   ))
   ORDER BY coalesce((SELECT sum(l.qty*l.unitPrice) FROM SupplierOrderLine l WHERE l.orderId=b.id),0)
   ${dir==="asc"?Prisma.sql`ASC`:Prisma.sql`DESC`}, b.id DESC LIMIT ${take} OFFSET ${skip}`):null
 const [items,total]=await Promise.all([
  db.supplierOrder.findMany({where:amountIds?{id:{in:amountIds.map(row=>row.id)}}:where,include:{
   supplier:true,lines:{include:{material:{select:materialSelect},requestLine:{include:{material:{select:materialSelect},request:{select:{id:true,ref:true,status:true}}}}}},
   receipts:register?false:{include:{lines:true},orderBy:{createdAt:"desc"}},
  },orderBy,take:register?take:legacyTake,skip:amountIds?0:register?skip:legacySkip}),
  register?db.supplierOrder.count({where}):Promise.resolve(0)
 ])
 const amountPosition=new Map(amountIds?.map((row,index)=>[row.id,index]))
 if(amountIds)items.sort((a,b)=>(amountPosition.get(a.id)??0)-(amountPosition.get(b.id)??0))
 const sanitised=items.map(o=>({...o,
  supplier:pricing?o.supplier:{id:o.supplier.id,code:o.supplier.code,name:o.supplier.name,active:o.supplier.active,
   phone:null,email:null,address:null},
  lines:o.lines.map(l=>{
  const {material,requestLine,...lineRest}=l
  const requestUnitPrice=requestLine?requestLine.unitPrice:null
  const materialDto={...material,unitPrice:pricing?material.unitPrice:null,averageCost:pricing?(material.averageCost==null?null:String(material.averageCost)):null}
  const requestLineDto=requestLine?{...requestLine,material:{...requestLine.material,unitPrice:pricing?requestLine.material.unitPrice:null,averageCost:pricing?(requestLine.material.averageCost==null?null:String(requestLine.material.averageCost)):null},unitPrice:pricing?requestUnitPrice:null}:null
  return {...lineRest,priceSourceType:pricing?lineRest.priceSourceType:null,priceSourceId:pricing?lineRest.priceSourceId:null,priceSourceRef:pricing?lineRest.priceSourceRef:null,unitPrice:pricing?l.unitPrice:null,material:materialDto,requestLine:requestLineDto}
 })}))
 if(register)return NextResponse.json({items:sanitised,pagination:documentPagination(page,pageSize,total)})
 if(receivable)return NextResponse.json({items:sanitised})
 const [requests,agreements,winningQuotes]=await Promise.all([
  db.purchaseRequest.findMany({where:{status:{in:["approved","partially_approved","ordered","partial"]}},include:{lines:{include:{material:true,supplierOrderLines:{include:{order:{select:{status:true}}}}}}},orderBy:[{expectedDate:"asc"},{createdAt:"asc"}]}),
  pricing?db.supplierPriceAgreement.findMany({where:{status:"approved",validFrom:{lte:new Date()},validUntil:{gte:new Date()},supplier:{is:{active:true}}},include:{supplier:{include:{materials:true}}}}):Promise.resolve([]),
  pricing?db.supplierQuoteOffer.findMany({where:{chosen:true,confirmationStatus:"confirmed",validUntil:{gte:new Date()},rfq:{is:{status:"awarded"}},supplier:{is:{active:true}}},include:{rfq:true,supplier:{include:{materials:true}},attachments:{select:{id:true,revisionNo:true}}}}):Promise.resolve([])
 ])
 const candidates=requests.flatMap(p=>p.lines.map(l=>({requestId:p.id,requestRef:p.ref,requestStatus:p.status,expectedDate:p.expectedDate?.toISOString()??null,createdAt:p.createdAt.toISOString(),requestLineId:l.id,materialId:l.materialId,materialName:l.material.name,unit:l.material.unit,requested:l.qty,approved:l.approvedQty,received:l.receivedQty,committed:Math.max(0,l.approvedQty-l.receivedQty-remainingToOrder(l)),available:remainingToOrder(l),unitPrice:pricing?(l.unitPrice??l.material.unitPrice):null}))).filter(x=>x.available>0.000001)
 const awardedAllocations=pricing?await db.supplierAwardAllocation.findMany({where:{plan:{status:'approved'}},select:{offerId:true,qty:true}}):[];
 const allocatedQuantity=new Map(awardedAllocations.map(a=>[a.offerId,a.qty]));
 const contractAllocations=pricing?await db.supplierAwardContractAllocation.findMany({where:{plan:{status:'approved'}},include:{plan:{select:{rfq:{select:{requestLineId:true}}}}}}):[];
 const availableSources=pricing?[...agreements.filter(a=>{const link=a.supplier.materials.find(m=>m.materialId===a.materialId);return !!link&&a.documentRef?.trim()&&a.approvedBy&&a.approvedBy!==a.createdBy&&validPriceSourceConversion({priceBasis:a.priceBasis,priceBasisFactor:a.priceBasisFactor,sourceUnitPrice:a.sourceUnitPrice===null?null:Number(a.sourceUnitPrice),unitPrice:Number(a.unitPrice)},link.unitsPerPurchase)}).flatMap(a=>contractAllocations.filter(allocation=>allocation.agreementId===a.id&&allocation.plan.rfq.requestLineId!==null).map(allocation=>({type:"CONTRACT" as const,id:a.id,supplierId:a.supplierId,materialId:a.materialId,requestLineId:allocation.plan.rfq.requestLineId,ref:a.contractRef,unitPrice:Number(a.unitPrice),validUntil:a.validUntil.toISOString(),offeredQty:allocation.qty,requiresSourcingDecision:false}))),...winningQuotes.filter(q=>{const link=q.supplier.materials.find(m=>m.materialId===q.rfq.materialId);return q.rfq.requestLineId!=null&&isAuthorizedSupplierQuote({...q,attachments:q.attachments.filter(a=>a.revisionNo===q.revisionNo)})&&!!link&&validPriceSourceConversion({priceBasis:q.priceBasis,priceBasisFactor:q.priceBasisFactor,sourceUnitPrice:q.sourceUnitPrice===null?null:Number(q.sourceUnitPrice),unitPrice:Number(q.unitPrice)},link.unitsPerPurchase)}).map(q=>({type:"QUOTE" as const,id:q.id,supplierId:q.supplierId,materialId:q.rfq.materialId,requestLineId:q.rfq.requestLineId,ref:q.quoteRef!,unitPrice:Number(q.unitPrice),validUntil:q.validUntil!.toISOString(),offeredQty:allocatedQuantity.get(q.id)??q.qty}))]:[]
 return NextResponse.json({items:sanitised,candidates,availableSources})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req,"buyer");if(denied)return denied
 const actor=currentActor(req)!.username
 const p=S.safeParse(await req.json().catch(()=>null));if(!p.success)return NextResponse.json({error:"BC invalide",details:p.error.flatten()},{status:400})
 const d=p.data
 if(new Set(d.lines.map(l=>l.requestLineId)).size!==d.lines.length)return NextResponse.json({error:"Ligne DA répétée"},{status:400})
 if(d.expectedDate&&Number.isNaN(Date.parse(d.expectedDate)))return NextResponse.json({error:"Date prévue invalide"},{status:400})
 try{
  const order=await serializedSQLiteWrite(() => db.$transaction(async tx=>{
   const supplier=await tx.supplier.findUnique({where:{id:d.supplierId},include:{materials:true}})
   if(!supplier||!supplier.active)throw new Error("SUPPLIER")
   const requested=await tx.purchaseRequestLine.findMany({where:{id:{in:d.lines.map(l=>l.requestLineId)}},include:{request:true,material:{select:{unit:true}},supplierOrderLines:{include:{order:true}}}})
   if(requested.length!==d.lines.length)throw new Error("MISSING_DA_LINE")
   const authorisedSources=new Map<number,string>()
   for(const line of d.lines){
    const r=requested.find(l=>l.id===line.requestLineId)!
    if(!["approved","partially_approved","ordered","partial"].includes(r.request.status))throw new Error("DA_NOT_APPROVED")
    if(!isValidPurchaseQuantity(line.qty,r.material.unit))throw new Error("INVALID_UNIT_QTY")
    const offer=supplier.materials.find(x=>x.materialId===r.materialId)
    if(!offer)throw new Error("SUPPLIER_NOT_APPROVED_FOR_MATERIAL")
    if(!(offer.unitsPerPurchase>0))throw new Error("INVALID_CONVERSION")
    const purchaseQty=line.purchaseQty??line.qty/offer.unitsPerPurchase
    if(!isValidPurchaseQuantity(purchaseQty,offer.purchaseUnit||r.material.unit)||Math.abs(purchaseQty*offer.unitsPerPurchase-line.qty)>0.000001)throw new Error("INVALID_CONVERSION")
    // Justificatif obligatoire : un prix indicatif ne permet JAMAIS à lui seul de commander.
    const source:PriceSource|undefined=line.sourceType==="CONTRACT"
     ?await tx.supplierPriceAgreement.findUnique({where:{id:line.sourceId}}).then(a=>a?({type:"CONTRACT" as const,id:a.id,supplierId:a.supplierId,materialId:a.materialId,unitPrice:Number(a.unitPrice),priceBasis:a.priceBasis,priceBasisFactor:a.priceBasisFactor,sourceUnitPrice:a.sourceUnitPrice===null?null:Number(a.sourceUnitPrice),ref:a.contractRef,validFrom:a.validFrom,validUntil:a.validUntil,approved:a.status==="approved"&&Boolean(a.approvedBy)&&a.createdBy!==a.approvedBy}):undefined)
     :await tx.supplierQuoteOffer.findUnique({where:{id:line.sourceId},include:{rfq:true,attachments:{select:{id:true,revisionNo:true}}}}).then(q=>q?({type:"QUOTE" as const,id:q.id,supplierId:q.supplierId,materialId:q.rfq.materialId,unitPrice:Number(q.unitPrice),priceBasis:q.priceBasis,priceBasisFactor:q.priceBasisFactor,sourceUnitPrice:q.sourceUnitPrice===null?null:Number(q.sourceUnitPrice),ref:q.quoteRef??"",validUntil:q.validUntil,approved:q.rfq.status==="awarded"&&isAuthorizedSupplierQuote({...q,attachments:q.attachments.filter(a=>a.revisionNo===q.revisionNo)}),requestLineId:q.rfq.requestLineId,offeredQty:q.qty}):undefined)
    if(line.sourceType==='QUOTE'&&source){
     const plan=await tx.supplierAwardPlan.findFirst({where:{rfq:{offers:{some:{id:line.sourceId}}},status:'approved'},include:{lines:{where:{offerId:line.sourceId}}}});
     if(plan)source.offeredQty=plan.lines[0]?.qty??0;
    }
    if(!source||!sourceIsValid(source,{supplierId:d.supplierId,materialId:r.materialId,requestLineId:r.id,qty:line.qty,unitPrice:line.unitPrice,conversionFactor:offer.unitsPerPurchase}))throw new Error("PRICE_NOT_AUTHORIZED")
    // P5.15.19: même pour un contrat déjà approuvé, le RESPONSABLE achats
    // doit avoir approuvé explicitement l'attribution DANS une consultation.
    // L'API directe ne doit pas contourner cette décision (ou la quantité retenue).
    if(line.sourceType==='CONTRACT'){
     const chosen=await tx.supplierAwardContractAllocation.findMany({
      where:{agreementId:line.sourceId,plan:{status:'approved',rfq:{requestLineId:r.id}}},
      include:{plan:{select:{id:true,decidedBy:true,proposedBy:true}},agreement:{select:{unitPrice:true,status:true}}}
     });
     const approved=chosen.filter(a=>a.plan.decidedBy&&a.plan.decidedBy!==a.plan.proposedBy&&a.agreement.status==='approved'&&Math.abs(Number(a.unitPrice)-line.unitPrice)<=0.0001);
     const allowedQty=approved.reduce((n,a)=>n+a.qty,0);
     const used=await tx.supplierOrderLine.findMany({where:{requestLineId:r.id,priceSourceType:'CONTRACT',priceSourceId:line.sourceId,order:{status:{in:['draft','confirmed','partial','received','closed']}}},select:{qty:true}});
     if(!approved.length||used.reduce((n,l)=>n+l.qty,0)+line.qty>allowedQty+0.000001)throw new Error('CONTRACT_AWARD_REQUIRED');
    }
    authorisedSources.set(line.requestLineId,source.ref)
    if(line.sourceType==="QUOTE"){
     const already=await tx.supplierOrderLine.findMany({where:{priceSourceType:"QUOTE",priceSourceId:line.sourceId,order:{status:{in:["draft","confirmed","partial","received"]}}},select:{qty:true}})
     if(already.reduce((sum,x)=>sum+x.qty,0)+line.qty>(source.offeredQty??0)+0.000001)throw new Error("QUOTE_QTY_EXCEEDED")
    }
    if(line.qty>remainingToOrder(r)+0.000001)throw new Error("DA_EXCEEDED")
   }
   const ref=await nextRef("BC","supplierOrder",tx)
   const created=await tx.supplierOrder.create({data:{ref,supplierId:d.supplierId,status:"draft",createdBy:actor,expectedDate:d.expectedDate?new Date(d.expectedDate):null,note:d.note||null,lines:{create:d.lines.map(l=>({requestLineId:l.requestLineId,materialId:requested.find(r=>r.id===l.requestLineId)!.materialId,qty:l.qty,unitPrice:l.unitPrice,purchaseQty:l.purchaseQty??l.qty/(supplier.materials.find(v=>v.materialId===requested.find(r=>r.id===l.requestLineId)!.materialId)?.unitsPerPurchase??1),purchaseUnit:supplier.materials.find(v=>v.materialId===requested.find(r=>r.id===l.requestLineId)!.materialId)?.purchaseUnit??null,conversionFactor:supplier.materials.find(v=>v.materialId===requested.find(r=>r.id===l.requestLineId)!.materialId)?.unitsPerPurchase??1,priceSourceType:l.sourceType,priceSourceId:l.sourceId,priceSourceRef:authorisedSources.get(l.requestLineId)??null}))}}})
   await tx.auditEvent.create({data:{actor,action:"SUPPLIER_ORDER_DRAFTED",entity:"SupplierOrder",entityId:String(created.id),details:JSON.stringify({ref,supplierId:d.supplierId})}})
   return created
  }))
  return NextResponse.json({order},{status:201})
 }catch(e){
  const code=e instanceof Error?e.message:""
  const messages:Record<string,string>={INVALID_UNIT_QTY:"Quantité invalide pour l’unité de stock",SUPPLIER:"Fournisseur inactif ou introuvable",MISSING_DA_LINE:"Ligne DA introuvable",DA_NOT_APPROVED:"DA non validée",SUPPLIER_NOT_APPROVED_FOR_MATERIAL:"Matière non associée à ce fournisseur",DA_EXCEEDED:"Quantité supérieure au besoin non encore commandé",INVALID_CONVERSION:"Conversion unité achat / unité stock incohérente",PRICE_NOT_AUTHORIZED:"BC bloqué : devis attribué ou contrat approuvé valide obligatoire. Le prix indicatif ne suffit pas.",QUOTE_QTY_EXCEEDED:"Quantité totale supérieure à celle du devis retenu",CONTRACT_AWARD_REQUIRED:"Contrat non attribué dans une consultation approuvée ou quantité contractuelle déjà engagée"}
  return NextResponse.json({error:messages[code]??"Création BC impossible ou modifiée simultanément. Actualisez."},{status:409})
 }
}
