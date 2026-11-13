import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { accessGate, currentActor, hasRole, hasPermission } from "@/lib/access-gate"
import { db } from "@/lib/db"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { WORK_ORDER_NEXT } from "@/lib/work-order-labels"
import { workOrderDtoForViewer } from "@/lib/work-order-dto"
import {stockForSale} from "@/lib/article-trade"
import {stockFree,reservedLotQty,EPS} from "@/lib/sales-stock-reservation"
import {isValidStockQuantity} from "@/lib/stock-quantity"

export const dynamic="force-dynamic"
const Schema=z.object({
  action:z.enum(["approve","start","complete","prepare","cancel","reactivate"]),
  reason:z.string().trim().min(10).max(500).optional(),
}).strict()
export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){
  const denied=accessGate(req)
  if(denied)return denied
  const {id}=await ctx.params
  const oid=Number(id)
  if(!Number.isSafeInteger(oid)||oid<=0)return NextResponse.json({error:"OF invalide"},{status:400})
  const parsed=Schema.safeParse(await req.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:"Transition ou motif invalide"},{status:400})
  const {action,reason}=parsed.data
  const operator=["start","complete","prepare"].includes(action)
  const eligible=operator
    ? hasRole(req,"inventory") && (!currentActor(req)?.managed || hasPermission(req,"stock.move"))
    : hasRole(req,"approver") && (!currentActor(req)?.managed || hasPermission(req,"sales.approve"))
  if(!eligible)return NextResponse.json({error:operator?"Préparation réservée au magasinier":"Décision réservée au responsable"},{status:403})
  if(["cancel","reactivate"].includes(action)&&!reason)
    return NextResponse.json({error:"Motif de 10 à 500 caractères obligatoire"},{status:400})
  const before=action==="approve"?"draft":action==="prepare"||action==="start"?"approved":action==="complete"?"in_progress":
    action==="reactivate"?"cancelled":null
  const after=action==="cancel"?"cancelled":action==="reactivate"?"draft":
    action==="prepare"?"completed":before?WORK_ORDER_NEXT[before]:null
  const actor=currentActor(req)!.username
  try {
    const result=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
      if(action==="prepare" || action==="cancel"){
        // P5.15.22 (CLT-04) : verrou d'écriture SQLite AVANT toute lecture de
        // stock, même convention que reserve-stock (sales/route.ts). En mode
        // différé, la photographie de lecture serait sinon prise avant le
        // verrou : deux préparations simultanées depuis des processus distincts
        // liraient le même stock et se déclareraient toutes deux disponibles.
        await tx.salesDocCounter.upsert({where:{id:"GOCMD_OF_PREPARE_LOCK"},create:{id:"GOCMD_OF_PREPARE_LOCK",value:1},update:{value:{increment:1}}})
      }
      const item=await tx.workOrder.findUnique({where:{id:oid},include:{order:{include:{lines:{include:{product:true}}}}}})
      if(!item)throw new Error("NOT_FOUND")
      if(item.order.fulfillmentStatus!=="open" || ["pending_validation","rejected","shipped"].includes(item.order.status))
        throw new Error("INVALID_STATE")
      if(item.order.lines.some(l=>l.priceApprovalStatus==="pending" || l.product.status!=="active" || (l.product.specialNotes && l.product.specialPriceStatus!=="approved")))
        throw new Error("PRODUCT_INVALID")
      const cancelling=action==="cancel" && (["draft","approved"].includes(item.status) || (item.status==="completed" && item.preparationKind==="stock"))
      if(!cancelling && item.status!==before)throw new Error("INVALID_STATE")
      if(action==="approve" && item.createdBy===actor)throw new Error("SELF_APPROVAL")
      if(action==="prepare"){
        // L'opération « préparer » est possible pour les articles revendus
        // OU les matelas déjà disponibles en stock fini. Aucun mouvement créé.
        const snap=JSON.parse(item.snapshotJson) as {stockTrade?:boolean;pieces?:unknown[]}
        const line=item.order.lines.find(l=>l.id===item.orderLineId)
        if(!line)throw Error("LINE_NOT_FOUND")
        if(snap.stockTrade===true){
          if((snap.pieces?.length??0)!==0||!line.product.materialId||!line.stockUnit)throw Error("NOT_STOCK_PREPARATION")
          // RR-06: preparing a resale OF must COMMIT stock, not only check it.
          // Atomically replace reservations for the undelivered balance. The
          // transaction's write-first lock and stock-lot SQL triggers prevent
          // concurrent OFs from claiming the same physical lot.
          const delivered=await tx.salesDeliveryLine.aggregate({where:{orderLineId:line.id},_sum:{qty:true}})
          const remainingSales=Math.round((line.qty-(delivered._sum.qty??0))*1000)/1000
          const needed=stockForSale(remainingSales,line.unit,line.stockUnit,line.stockUnitsPerSale)
          if(needed===null || needed<=EPS)throw Error("INVALID_STOCK_PREPARATION_QTY")
          await tx.salesStockReservation.deleteMany({where:{orderLineId:line.id}})
          const lots=await tx.stockLot.findMany({where:{materialId:line.product.materialId,status:"available",qty:{gt:0},
            OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},
            orderBy:[{expiresAt:{sort:"asc",nulls:"last"}},{receivedAt:"asc"},{id:"asc"}]})
          let pending=needed
          for(const lot of lots){
            if(pending<=EPS)break
            const available=stockFree(lot.qty,await reservedLotQty(tx,lot.id))
            const take=Math.round(Math.min(available,pending)*1000)/1000
            if(take<=EPS)continue
            if(!isValidStockQuantity(take,line.stockUnit))throw Error("INVALID_STOCK_PREPARATION_QTY")
            await tx.salesStockReservation.create({data:{orderLineId:line.id,stockLotId:lot.id,qty:take,createdBy:actor}})
            pending=Math.round((pending-take)*1000)/1000
          }
          if(pending>EPS)throw Error("STOCK_NOT_AVAILABLE_FOR_PREPARATION")
        }else{
          if(line.product.materialId!==null||line.unit!=="u")throw Error("NOT_STOCK_PREPARATION")
          const lots=await tx.finishedStockLot.findMany({where:{productId:line.productId,status:"available",qty:{gt:0},
            OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},
            orderBy:[{expiresAt:{sort:"asc",nulls:"last"}},{receivedAt:"asc"},{id:"asc"}]})
          // P5.15.23 : réserver des lots RÉELS en transaction, FEFO, sans sortie
          // physique. Les autres préparations et les BL ne peuvent plus les prendre.
          const already=await tx.salesDeliveryLine.aggregate({where:{orderLineId:line.id},_sum:{qty:true}})
          const need=line.qty-(already._sum.qty??0)
          if(!Number.isSafeInteger(need)||need<1)throw Error("INVALID_FINISHED_QUANTITY")
          const reserved=await tx.finishedStockReservation.findMany({where:{lotId:{in:lots.map(l=>l.id)}}})
          const used=new Map<number,number>()
          for(const b of reserved)used.set(b.lotId,(used.get(b.lotId)??0)+b.qty)
          // OF historiques antérieurs à la migration : leur engagement n'est
          // pas transformé artificiellement en réservations physiques.
          const legacy=await tx.orderLine.findMany({where:{id:{not:line.id},productId:line.productId,unit:"u",
            workOrder:{status:"completed",preparationKind:"legacy_stock"},order:{fulfillmentStatus:"open"}},select:{id:true,qty:true}})
          let oldCommitted=0
          for(const other of legacy){
            const delivered=await tx.salesDeliveryLine.aggregate({where:{orderLineId:other.id},_sum:{qty:true}})
            oldCommitted+=Math.max(0,other.qty-(delivered._sum.qty??0))
          }
          if(lots.reduce((n,l)=>n+l.qty-(used.get(l.id)??0),0)-oldCommitted<need)
            throw Error("STOCK_NOT_AVAILABLE_FOR_PREPARATION")
          let remaining=need
          for(const lot of lots){
            if(remaining===0)break
            const free=Math.max(0,lot.qty-(used.get(lot.id)??0))
            const take=Math.min(free,remaining)
            if(take>0){
              await tx.finishedStockReservation.create({data:{orderLineId:line.id,lotId:lot.id,qty:take,createdBy:actor}})
              remaining-=take
            }
          }
          if(remaining!==0)throw Error("STOCK_NOT_AVAILABLE_FOR_PREPARATION")

        }
      }
      if(action==="cancel" && item.preparationKind==="stock"){
        const sent=await tx.salesDeliveryLine.count({where:{orderLineId:item.orderLineId}})
        if(sent)throw Error("ALREADY_DELIVERED")
        await tx.finishedStockReservation.deleteMany({where:{orderLineId:item.orderLineId}})
        // An OF for direct resale owns material reservations too.
        await tx.salesStockReservation.deleteMany({where:{orderLineId:item.orderLineId}})
      }
      const now=new Date()
      const fields=action==="approve"?{approvedBy:actor,approvedAt:now}:
        action==="start"?{startedBy:actor,startedAt:now}:
        action==="prepare"?{completedBy:actor,completedAt:now,preparationKind:"stock"}:
        action==="reactivate"?{createdBy:actor,approvedBy:null,approvedAt:null,startedBy:null,startedAt:null,completedBy:null,completedAt:null,preparationKind:null}:
        action==="complete"?{completedBy:actor,completedAt:now,preparationKind:"manufacturing"}:{}
      const changed=await tx.workOrder.updateMany({where:{id:oid,status:item.status},data:{status:after!,...fields}})
      if(changed.count!==1)throw new Error("CONFLICT")
      await tx.auditEvent.create({data:{actor,action:`WORK_ORDER_${action.toUpperCase()}`,entity:"WorkOrder",entityId:String(oid),
        details:JSON.stringify({ref:item.ref,from:item.status,to:after,reason:reason??null})}})
      return tx.workOrder.findUniqueOrThrow({where:{id:oid}})
    }))
    return NextResponse.json({workOrder:workOrderDtoForViewer(result,hasPermission(req,"clients.read"))},{headers:{"Cache-Control":"no-store"}})
  } catch(err){
    if(err instanceof Error && err.message==="NOT_FOUND")return NextResponse.json({error:"OF introuvable"},{status:404})
    if(err instanceof Error && err.message==="SELF_APPROVAL")return NextResponse.json({error:"Quatre yeux : le créateur ne peut pas approuver son propre OF"},{status:403})
    return NextResponse.json({error:"Transition OF refusée : état, contrôle ou validation incompatible"},{status:409})
  }
}
