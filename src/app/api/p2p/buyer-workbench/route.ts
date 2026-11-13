import { NextRequest, NextResponse } from 'next/server'
import { readRoleGate } from '@/lib/access-gate'
import { db } from '@/lib/db'
import { buildBuyerWorklist } from '@/lib/buyer-workbench'
import {calculateOpenMaterialDemand} from '@/lib/material-open-demand'

export const dynamic='force-dynamic'

/** Lecture seule et RBAC acheteur. Pas de prix, données clients, ni contacts fournisseurs.
 * Les compteurs proviennent des enregistrements réels ; aucune valeur démo codée en dur.
 */
export async function GET(req:NextRequest){
  const denied=readRoleGate(req,['buyer']);if(denied)return denied
  const active=['pending','approved','partially_approved','ordered','partial']
  const [materials,requests,inbound,reservations,materialOrders,waitingApprovals,preparedConsultations,openRfqs,openSupplierOrders]=await Promise.all([
    db.material.findMany({where:{minStock:{gt:0}},select:{id:true,ref:true,name:true,category:true,unit:true,stockQty:true,minStock:true,targetStock:true,isPurchasable:true,isManufactured:true,foamNature:true,
      supplierLinks:{where:{supplier:{active:true}},select:{supplierId:true}}}}),
    db.purchaseRequestLine.findMany({where:{request:{status:{in:active}}},select:{materialId:true,request:{select:{ref:true,status:true,createdAt:true}}}}),
    db.supplierOrderLine.findMany({where:{order:{status:{in:['confirmed','partial']}}},select:{materialId:true,qty:true,receivedQty:true}}),
    db.salesStockReservation.findMany({select:{orderLineId:true,qty:true,stockLot:{select:{materialId:true}}}}),
    db.orderLine.findMany({where:{order:{fulfillmentStatus:'open',status:{in:['new','production','ready']}},product:{materialId:{not:null}}},select:{id:true,qty:true,stockUnitsPerSale:true,product:{select:{materialId:true}}}}),
    db.purchaseRequest.count({where:{status:'pending'}}),
    db.supplierConsultation.count({where:{status:{in:['prepared','in_progress','pending_decision']}}}),
    db.supplierRFQ.count({where:{status:'open'}}),
    db.supplierOrder.count({where:{status:{in:['confirmed','partial']}}}),
  ])
  const reserved=new Map<number,number>()
  for(const r of reservations)reserved.set(r.stockLot.materialId,(reserved.get(r.stockLot.materialId)??0)+r.qty)
  const delivery=materialOrders.length?await db.salesDeliveryLine.findMany({where:{orderLineId:{in:materialOrders.map(x=>x.id)}},select:{orderLineId:true,qty:true}}):[]
  const demand=calculateOpenMaterialDemand(materialOrders.filter(x=>x.product.materialId!=null).map(x=>({id:x.id,materialId:x.product.materialId!,qty:x.qty,unitsPerSale:x.stockUnitsPerSale})),delivery,reservations)
  const result=buildBuyerWorklist(
    materials.map(({supplierLinks,...m})=>({...m,reservedQty:reserved.get(m.id)??0,unreservedSalesQty:demand.get(m.id)??0,activeSupplierCount:supplierLinks.length})),
    requests.map(line=>({materialId:line.materialId,requestRef:line.request.ref,status:line.request.status,requestedAt:line.request.createdAt.toISOString()})),
    inbound,
  )
  return NextResponse.json({
    ...result,
    workflow:{waitingApprovals,preparedConsultations,openRfqs,openSupplierOrders},
    note:'Proposition jusqu au stock cible : stock physique moins reservations plus BC fermes non recus. DA et fabrication soumises a validation nominative.',
  },{headers:{'Cache-Control':'private, no-store','Vary':'Authorization'}})
}
