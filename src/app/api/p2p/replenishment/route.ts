import {calculateReplenishment} from '@/lib/replenishment-policy'
import {calculateOpenMaterialDemand} from '@/lib/material-open-demand'
import { isValidStockQuantity, requiresInternalManufacturing, MAX_STOCK_QUANTITY } from "@/lib/stock-quantity"
import {accessGate,currentActor,hasAnyReadRole} from "@/lib/access-gate"
import {db} from "@/lib/db"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import {nextRef} from "@/lib/erp-server"
import {NextRequest,NextResponse} from "next/server"
import {z} from "zod"
const S=z.object({materialId:z.number().int().positive(),qty:z.number().finite().positive().max(MAX_STOCK_QUANTITY),note:z.string().trim().min(5).max(500)})
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 // Audit 10/11/2026 (SEC-READ-01, P3) : les propositions de réapprovisionnement
 // exposent le référencement fournisseur-matière et les délais (donnée de
 // négociation achats) : lecture réservée aux rôles supply-chain, comme
 // p2p/overview et p2p/warehouse — plus aucun rôle authentifié (ni le compte
 // démo partagé) ne peut cartographier les sources d'approvisionnement.
 if(!hasAnyReadRole(req,["buyer","approver","receiver","inventory","quality","finance","director"]))
  return NextResponse.json({error:"Lecture du réapprovisionnement réservée aux rôles achats et logistique"},{status:403,headers:{"Cache-Control":"no-store"}})
 const [materials,lines,bookings,materialOrders]=await Promise.all([
  db.material.findMany({where:{minStock:{gt:0}},include:{supplierLinks:{include:{supplier:{select:{id:true,name:true,active:true}}}}},orderBy:{ref:'asc'}}),
  db.supplierOrderLine.findMany({where:{order:{status:{in:['confirmed','partial']}}},select:{materialId:true,qty:true,receivedQty:true}}),
  db.salesStockReservation.findMany({select:{orderLineId:true,qty:true,stockLot:{select:{materialId:true}}}}),
  db.orderLine.findMany({where:{order:{fulfillmentStatus:'open',status:{in:['new','production','ready']}},product:{materialId:{not:null}}},select:{id:true,qty:true,stockUnitsPerSale:true,product:{select:{materialId:true}}}}),
 ])
 const inbound=new Map<number,number>(),reserved=new Map<number,number>()
 for(const l of lines)inbound.set(l.materialId,(inbound.get(l.materialId)??0)+Math.max(0,l.qty-l.receivedQty))
 for(const r of bookings)reserved.set(r.stockLot.materialId,(reserved.get(r.stockLot.materialId)??0)+r.qty)
 const deliveries=materialOrders.length?await db.salesDeliveryLine.findMany({where:{orderLineId:{in:materialOrders.map(x=>x.id)}},select:{orderLineId:true,qty:true}}):[]
 const demand=calculateOpenMaterialDemand(materialOrders.filter(x=>x.product.materialId!=null).map(x=>({id:x.id,materialId:x.product.materialId!,qty:x.qty,unitsPerSale:x.stockUnitsPerSale})),deliveries,bookings)
 const candidates=materials.flatMap(m=>{
  const procurementType=(!m.isPurchasable||requiresInternalManufacturing(m)||m.isManufactured)?'FABRICATION':'ACHAT'
  try{
   const c=calculateReplenishment({physical:m.stockQty,reserved:reserved.get(m.id)??0,unreservedDemand:demand.get(m.id)??0,
     firmInbound:procurementType==='ACHAT'?(inbound.get(m.id)??0):0,minStock:m.minStock,targetStock:m.targetStock,unit:m.unit})
   if(!c.triggered)return []
   return [{materialId:m.id,ref:m.ref,name:m.name,unit:m.unit,stockQty:m.stockQty,...c,procurementType,
     eligibleForPurchase:m.isPurchasable&&!requiresInternalManufacturing(m)&&!m.isManufactured&&m.supplierLinks.some(x=>x.supplier.active),
     suppliers:m.supplierLinks.filter(x=>x.supplier.active).map(x=>({id:x.supplier.id,name:x.supplier.name,leadTimeDays:x.leadTimeDays}))}]
  }catch{return []}
 })
 return NextResponse.json({items:candidates,note:"Propositions non commandées : chaque DA exige validation nominative"})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req,"buyer");if(denied)return denied
 const parsed=S.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Demande invalide"},{status:400})
 const d=parsed.data
 try {
  const item=await serializedSQLiteWrite(() => db.$transaction(async tx=>{
   const m=await tx.material.findUnique({where:{id:d.materialId},include:{supplierLinks:{include:{supplier:{select:{active:true}}}}}});if(!m)throw Error("MATERIAL_UNKNOWN")
   if(!isValidStockQuantity(d.qty,m.unit))throw Error("INVALID_UNIT_QTY")
   if(!m.isPurchasable||m.isManufactured||requiresInternalManufacturing(m))throw Error("INTERNAL_MANUFACTURE")
   if(!m.supplierLinks.some(x=>x.supplier.active))throw Error("NO_ACTIVE_SUPPLIER")
   // Reject concurrent/double suggested demand for this material until earlier one is closed.
   const open=await tx.purchaseRequestLine.count({where:{materialId:m.id,request:{status:{in:["pending","approved","partially_approved","ordered","partial"]}}}})
   if(open)throw Error("DA_ALREADY_OPEN")
   const ref=await nextRef("DA","purchaseRequest",tx)
   const created=await tx.purchaseRequest.create({data:{ref,status:"pending",createdBy:currentActor(req)!.username,note:`Réapprovisionnement proposé : ${d.note}`,lines:{create:[{materialId:m.id,qty:d.qty,unitPrice:m.unitPrice}]}}})
   await tx.auditEvent.create({data:{actor:currentActor(req)!.username,action:"REPLENISHMENT_REQUEST_CREATED",entity:"PurchaseRequest",entityId:String(created.id),details:JSON.stringify({materialId:m.id,qty:d.qty})}})
   return created
  }))
  return NextResponse.json({request:item,requiresApproval:true},{status:201})
 }catch(e){const code=e instanceof Error?e.message:"";const messages:Record<string,string>={DA_ALREADY_OPEN:"Une DA est déjà ouverte pour cette matière",INVALID_UNIT_QTY:"Quantité incompatible avec l’unité de stock",INTERNAL_MANUFACTURE:"Article fabriqué en interne : proposer une demande de fabrication dans Planification des stocks, pas une DA fournisseur",NO_ACTIVE_SUPPLIER:"Aucun fournisseur actif référencé pour cette matière",MATERIAL_UNKNOWN:"Matière introuvable"};return NextResponse.json({error:messages[code]??"Création de DA impossible",code},{status:code==="INVALID_UNIT_QTY"?400:409})}
}
