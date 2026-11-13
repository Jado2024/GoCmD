import { safeErrorMetadata } from "@/lib/safe-server-error"
import {readDocumentPage,documentPagination} from "@/lib/document-register"
import { placeReceipt } from "@/lib/p2p-placements"
import { receivedWeightedAverageCost } from "@/lib/stock-cost"
import { accessGate, currentActor, canSeeMaterialCosts } from "@/lib/access-gate"
import { db } from "@/lib/db"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { nextRef } from "@/lib/erp-server"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { isValidPurchaseQuantity } from "@/lib/purchase-quantity"

export const dynamic = "force-dynamic"
// The BC selection is compatibility-only; actual ownership is checked for EACH line.
const S=z.object({supplierOrderId:z.number().int().positive().optional(),deliveryRef:z.string().trim().min(2).max(90),operator:z.string().trim().min(2).max(80).optional(),note:z.string().trim().max(500).optional(),lines:z.array(z.object({supplierOrderLineId:z.number().int().positive(),acceptedQty:z.number().finite().min(0).max(1_000_000),rejectedQty:z.number().finite().min(0).max(1_000_000),lot:z.string().trim().min(1).max(100),expiresAt:z.iso.date().optional()})).min(1).max(100)})
const EPS=0.000001
function receiptRef(n:number){return `BR-${new Date().getFullYear()}-${String(n).padStart(5,"0")}`}
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 const pricing=canSeeMaterialCosts(req)
 const params=req.nextUrl.searchParams
 const register=params.get("view")==="register"
 const {page,pageSize,q,skip,take}=readDocumentPage(params)
 const supplierId=Number(params.get("supplierId")??0)
 const where={
  ...(Number.isSafeInteger(supplierId)&&supplierId>0?{supplierOrder:{supplierId}}:{}),
  ...(q?{OR:[{ref:{contains:q}},{deliveryRef:{contains:q}},{operator:{contains:q}},
   {supplierOrder:{OR:[{ref:{contains:q}},{supplier:{name:{contains:q}}}]}},
   {lines:{some:{OR:[{lot:{contains:q}},{supplierOrderLine:{material:{name:{contains:q}}}}]}}}
  ]}:{}),
 }
 const [items,total]=await Promise.all([
  db.goodsReceipt.findMany({where,include:{supplierOrder:{include:{supplier:true}},lines:{include:{supplierOrderLine:{include:{material:true}}}}},
   orderBy:[{createdAt:params.get("dir")==="asc"?"asc":"desc"},{id:"desc"}],take:register?take:200,skip:register?skip:0}),
  register?db.goodsReceipt.count({where}):Promise.resolve(0),
 ])
 const pagination=register?documentPagination(page,pageSize,total):undefined
 // Never serialize full Prisma relations to a receiver, quality officer or salesperson.
 // Minimal read DTO for warehouse operations; finance/buyers retain the historical detail.
 if(pricing)return NextResponse.json({items,pagination})
 return NextResponse.json({pagination,items:items.map(br=>({
  id:br.id,ref:br.ref,supplierOrderId:br.supplierOrderId,deliveryRef:br.deliveryRef,
  operator:br.operator,note:br.note,createdAt:br.createdAt,
  supplierOrder:{id:br.supplierOrder.id,ref:br.supplierOrder.ref,status:br.supplierOrder.status,
   supplierId:br.supplierOrder.supplierId,supplier:{id:br.supplierOrder.supplier.id,name:br.supplierOrder.supplier.name}},
  lines:br.lines.map(l=>({id:l.id,goodsReceiptId:l.goodsReceiptId,supplierOrderLineId:l.supplierOrderLineId,
   acceptedQty:l.acceptedQty,rejectedQty:l.rejectedQty,returnedQty:l.returnedQty,lot:l.lot,
   supplierOrderLine:{id:l.supplierOrderLine.id,orderId:l.supplierOrderLine.orderId,
    materialId:l.supplierOrderLine.materialId,qty:l.supplierOrderLine.qty,receivedQty:l.supplierOrderLine.receivedQty,
    material:{id:l.supplierOrderLine.material.id,ref:l.supplierOrderLine.material.ref,
     name:l.supplierOrderLine.material.name,unit:l.supplierOrderLine.material.unit}}}))
 }))})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req,"receiver");if(denied)return denied
 const actor=currentActor(req)!.username
 const parsed=S.safeParse(await req.json().catch(()=>null))
 if(!parsed.success)return NextResponse.json({error:"BR invalide : indiquer chaque numéro de lot et des quantités valides",details:parsed.error.flatten()},{status:400})
 const d=parsed.data
 // V18.9.1 (contre-audit A-04) : la date de péremption saisie en BR est
 // convertie une seule fois ; elle équipe les lots disponibles ET mis en
 // quarantaine (même origine physique).
 const expiryOf=(iso?:string)=>iso?new Date(iso+"T00:00:00Z"):undefined
 if(d.lines.some(l=>l.expiresAt&&Number.isNaN(Date.parse(l.expiresAt))))return NextResponse.json({error:"Date de péremption invalide"},{status:400})
 const sumByLine=new Map<number,{accepted:number,rejected:number}>()
 for(const l of d.lines){
  const v=sumByLine.get(l.supplierOrderLineId)??{accepted:0,rejected:0}
  v.accepted+=l.acceptedQty;v.rejected+=l.rejectedQty
  sumByLine.set(l.supplierOrderLineId,v)
 }
 if(!d.lines.some(l=>l.acceptedQty+l.rejectedQty>0))return NextResponse.json({error:"Réception vide"},{status:400})
 try{
  const result=await serializedSQLiteWrite(() => db.$transaction(async tx=>{
   const lines=await tx.supplierOrderLine.findMany({where:{id:{in:[...sumByLine.keys()]}},include:{order:true,material:true}})
   if(lines.length!==sumByLine.size)throw new Error("WRONG_LINE")
   const supplierId=lines[0].order.supplierId
   const orderIds=[...new Set(lines.map(x=>x.orderId))]
   if(lines.some(l=>l.order.supplierId!==supplierId||!["confirmed","partial"].includes(l.order.status)))throw new Error("INVALID_BC")
   if(d.supplierOrderId&&!orderIds.includes(d.supplierOrderId))throw new Error("WRONG_LINE")
   const reference=d.deliveryRef.trim().toUpperCase().replace(/\s+/g," ")
   // UNIQUE DB constraint, not a preflight-only check. One BL may cover N BCs.
   const document=await tx.supplierDeliveryNote.create({data:{supplierId,reference}})
   for(const l of lines){
    const entries=d.lines.filter(e=>e.supplierOrderLineId===l.id)
    if(entries.some(e=>(e.acceptedQty>0&&!isValidPurchaseQuantity(e.acceptedQty,l.material.unit))||(e.rejectedQty>0&&!isValidPurchaseQuantity(e.rejectedQty,l.material.unit))||!isValidPurchaseQuantity(e.acceptedQty+e.rejectedQty,l.material.unit)))throw new Error("INVALID_UNIT_QTY")
    const qty=sumByLine.get(l.id)!
    if(!isValidPurchaseQuantity(qty.accepted+qty.rejected,l.material.unit))throw new Error("INVALID_UNIT_QTY")
    if(qty.accepted+qty.rejected>l.qty-l.receivedQty+EPS)throw new Error("OVER_RECEIPT")
   }
   const refs=await tx.goodsReceipt.findMany({where:{ref:{startsWith:`BR-${new Date().getFullYear()}-`}},select:{ref:true}})
   let sequence=Math.max(0,...refs.map(r=>Number(r.ref.split("-").at(-1))||0))
   const receipts: {id:number;ref:string;orderId:number}[]=[]
   for(const orderId of orderIds){
    const order=lines.find(l=>l.orderId===orderId)!.order
    const ref=receiptRef(++sequence)
    const br=await tx.goodsReceipt.create({data:{ref,supplierOrderId:order.id,deliveryRef:reference,deliveryNoteId:document.id,operator:actor,note:d.note??null}})
    receipts.push({id:br.id,ref,orderId})
    for(const entry of d.lines){
     const line=lines.find(x=>x.id===entry.supplierOrderLineId)
     if(!line||line.orderId!==orderId||entry.acceptedQty+entry.rejectedQty<=0)continue
     const code=entry.lot.trim().toUpperCase()
     const stored=await tx.goodsReceiptLine.create({data:{goodsReceiptId:br.id,supplierOrderLineId:line.id,acceptedQty:entry.acceptedQty,rejectedQty:entry.rejectedQty,lot:code}})
     if(entry.acceptedQty>0){
      const upd=await tx.supplierOrderLine.updateMany({where:{id:line.id,receivedQty:{lte:line.qty-entry.acceptedQty+EPS}},data:{receivedQty:{increment:entry.acceptedQty}}})
      if(upd.count!==1)throw new Error("OVER_RECEIPT")
      if(line.requestLineId){
       const requestLine=await tx.purchaseRequestLine.findUniqueOrThrow({where:{id:line.requestLineId}})
       const upr=await tx.purchaseRequestLine.updateMany({where:{id:line.requestLineId,receivedQty:{lte:requestLine.approvedQty-entry.acceptedQty+EPS}},data:{receivedQty:{increment:entry.acceptedQty}}})
       if(upr.count!==1)throw new Error("DA_EXCEEDED")
      }
      const lot=await tx.stockLot.create({data:{materialId:line.materialId,lotCode:code,status:"available",qty:entry.acceptedQty,supplierId,receiptLineId:stored.id,provenanceKey:`BRL-${stored.id}`,expiresAt:expiryOf(entry.expiresAt)}})
      await placeReceipt(tx,lot.id,entry.acceptedQty)
      const before=await tx.material.findUniqueOrThrow({where:{id:line.materialId}})
      const average=receivedWeightedAverageCost(before.stockQty,before.averageCost===null?null:Number(before.averageCost),before.unitPrice,entry.acceptedQty,line.unitPrice)
      await tx.material.update({where:{id:line.materialId},data:{stockQty:{increment:entry.acceptedQty},averageCost:average}})
      const m=await tx.movement.create({data:{ref:await nextRef("MVT","movement",tx),materialId:line.materialId,stockLotId:lot.id,type:"in",qty:entry.acceptedQty,signedQty:entry.acceptedQty,unit:line.material.unit,reason:`BR ${ref} – BC ${order.ref}`,document:`${ref} / BL ${reference}`,operator:actor}})
      await tx.goodsReceiptLine.update({where:{id:stored.id},data:{movementId:m.id}})
     }
     if(entry.rejectedQty>0){
      const rejectedLot=await tx.stockLot.create({data:{materialId:line.materialId,lotCode:code,status:"quarantine",qty:entry.rejectedQty,supplierId,receiptLineId:stored.id,provenanceKey:`BRL-${stored.id}`,expiresAt:expiryOf(entry.expiresAt)}})
      await placeReceipt(tx,rejectedLot.id,entry.rejectedQty)
     }
    }
   }
   for(const orderId of orderIds){
    const lns=await tx.supplierOrderLine.findMany({where:{orderId}})
    const complete=lns.every(l=>l.receivedQty>=l.qty-EPS)
    await tx.supplierOrder.update({where:{id:orderId},data:{status:complete?"received":"partial"}})
   }
   for(const requestId of new Set((await tx.purchaseRequestLine.findMany({where:{id:{in:lines.map(l=>l.requestLineId).filter((id):id is number=>id!==null)}},select:{requestId:true}})).map(r=>r.requestId))){
    const lns=await tx.purchaseRequestLine.findMany({where:{requestId}})
    const complete=lns.every(l=>l.receivedQty>=l.approvedQty-EPS)
    const any=lns.some(l=>l.receivedQty>EPS)
    await tx.purchaseRequest.updateMany({where:{id:requestId,status:{notIn:["closed","received"]}},data:{status:complete?"received":any?"partial":"ordered"}})
   }
   await tx.auditEvent.create({data:{actor,action:"SUPPLIER_DELIVERY_RECEIVED",entity:"SupplierDeliveryNote",entityId:String(document.id),details:JSON.stringify({reference,receipts})}})
   return {deliveryNoteId:document.id,receipts,ref:receipts[0]?.ref,status:"recorded"}
  }))
  return NextResponse.json(result,{status:201})
 }catch(e){
  const code=e instanceof Error?e.message:""
  // P5.15.21 RC (DEF-A-06) : collision d'unicité sur le BL (contraintes
  // SupplierDeliveryNote[supplierId,reference] / GoodsReceipt[supplierOrderId,
  // deliveryRef]) — rejet métier légitime : message explicite au lieu du
  // générique, sans console.error bruyant.
  if((e as {code?:string}).code==="P2002")
   return NextResponse.json({error:"BL déjà réceptionné : ce numéro de bon de livraison existe déjà pour ce fournisseur"},{status:409})
  const messages:Record<string,string>={WRONG_LINE:"Ligne BC introuvable ou mal associée",INVALID_UNIT_QTY:"Quantité réceptionnée incompatible avec l’unité de stock",INVALID_BC:"BC non confirmé ou fournisseur différent",OVER_RECEIPT:"Livraison supérieure au solde accepté",DA_EXCEEDED:"DA sur-réceptionnée",MIGRATION_V08_REQUISE:"Emplacement de réception DEFAULT/A_AFFECTER manquant : initialiser les dépôts avant la première réception."}
  if(code==="MIGRATION_V08_REQUISE") return NextResponse.json({error:messages[code]},{status:503})
  if(!messages[code])console.error("Échec réception fournisseur",safeErrorMetadata(e))
  return NextResponse.json({error:messages[code]??"Réception non validée : vérifier le BL, les quantités et les journaux serveur."},{status:409})
 }
}
