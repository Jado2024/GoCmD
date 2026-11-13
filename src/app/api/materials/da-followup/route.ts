import { NextRequest, NextResponse } from 'next/server'
import { readRoleGate } from '@/lib/access-gate'
import { db } from '@/lib/db'
import { openDaStatuses, summarizeMaterialDa } from '@/lib/material-da-summary'

import type { MaterialSupply } from '@/lib/material-replenishment'
import { calculateOpenMaterialDemand } from '@/lib/material-open-demand'

export const dynamic = 'force-dynamic'

/** Dossier des DA par matière : quantités uniquement, sans coûts/prix fournisseur. */
export async function GET(req: NextRequest) {
  const denied = readRoleGate(req, ['buyer','approver'])
  if (denied) return denied
  const page=Math.max(1,Math.min(1_000_000,Math.trunc(Number(req.nextUrl.searchParams.get('page')??1)||1)))
  const pageSize=Math.max(1,Math.min(200,Math.trunc(Number(req.nextUrl.searchParams.get('pageSize')??100)||100)))
  const materialId=Number(req.nextUrl.searchParams.get('materialId')??0)
  const where=Number.isSafeInteger(materialId)&&materialId>0?{lines:{some:{materialId}}}:{}
  const select = {
      id:true,ref:true,status:true,createdAt:true,expectedDate:true,
      lines:{select:{
        id:true,materialId:true,qty:true,approvedQty:true,receivedQty:true,
        supplierOrderLines:{select:{qty:true,receivedQty:true,order:{select:{ref:true,status:true}}}},
      }},
  } as const
  if (req.nextUrl.searchParams.get('scope') === 'open') {
    const [purchases, orders, reservations, tradeLines, tradeDeliveries, tradeReservations] = await db.$transaction([
      db.purchaseRequest.findMany({where:{...where,status:{in:openDaStatuses}},select}),
      db.supplierOrderLine.findMany({
        where:{order:{status:{in:['confirmed','partial']}}},
        select:{materialId:true,qty:true,receivedQty:true,order:{select:{ref:true,expectedDate:true}}},
        orderBy:[{order:{expectedDate:'asc'}},{orderId:'asc'},{id:'asc'}],
      }),
      db.salesStockReservation.findMany({select:{qty:true,stockLot:{select:{materialId:true}}}}),
      // AUDIT P5.15.27-A (FORM-01) : engagements clients non encore servis,
      // mêmes sources que le moteur /api/stock-planning (négoce, commande ouverte).
      db.orderLine.findMany({
        where:{order:{fulfillmentStatus:'open',status:{in:['new','production','ready']}},product:{materialId:{not:null}}},
        select:{id:true,qty:true,stockUnitsPerSale:true,product:{select:{materialId:true}}},
      }),
      db.salesDeliveryLine.findMany({select:{orderLineId:true,qty:true}}),
      db.salesStockReservation.findMany({select:{orderLineId:true,qty:true}}),
    ])
    const supply: Record<number, MaterialSupply> = {}
    for (const row of orders) {
      const qty = Math.max(0, Math.round((row.qty - row.receivedQty) * 1000) / 1000)
      if (!qty) continue
      const entry = supply[row.materialId] ??= {reservedQty:0,inbound:[]}
      entry.inbound.push({ref:row.order.ref,qty,expectedDate:row.order.expectedDate?.toISOString() ?? null})
    }
    for (const row of reservations) {
      const entry = supply[row.stockLot.materialId] ??= {reservedQty:0,inbound:[]}
      entry.reservedQty += row.qty
    }
    const openDemand = calculateOpenMaterialDemand(
      tradeLines.map(l=>({id:l.id,materialId:l.product.materialId!,qty:l.qty,unitsPerSale:l.stockUnitsPerSale??1})),
      tradeDeliveries,
      tradeReservations,
    )
    for (const [materialId, qty] of openDemand) {
      if (qty <= 0) continue
      const entry = supply[materialId] ??= {reservedQty:0,inbound:[]}
      entry.openDemandQty = Math.round(((entry.openDemandQty ?? 0) + qty) * 1000) / 1000
    }
    return NextResponse.json({byMaterial:summarizeMaterialDa(purchases),supply}, {headers:{'Cache-Control':'no-store'}})
  }
  const [total, purchases] = await db.$transaction([
    db.purchaseRequest.count({where}),
    db.purchaseRequest.findMany({where,select,
      orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize,
    }),
  ])
  return NextResponse.json({byMaterial:summarizeMaterialDa(purchases),pagination:{page,pageSize,total,hasMore:page*pageSize<total,summaryScope:"current_page_only"}}, {headers:{'Cache-Control':'no-store'}})
}
