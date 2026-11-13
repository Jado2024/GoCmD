import { safeErrorMetadata } from "@/lib/safe-server-error"
import { NextRequest, NextResponse } from "next/server"
import { accessGate, currentActor, hasRole, hasPermission } from "@/lib/access-gate"
import { db } from "@/lib/db"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { createMissingWorkOrders, lineRequiresWorkOrder } from "@/lib/work-order-create"
import { workOrderDtoForViewer } from "@/lib/work-order-dto"
import { z } from "zod"
import type { Prisma } from "@prisma/client"

export const dynamic="force-dynamic"
const CreateSchema=z.object({orderLineId:z.number().int().positive()}).strict()
function allowedRead(req:NextRequest) {
  const actor=currentActor(req)
  return Boolean(actor && !actor.legacy && (
    actor.roles.includes("inventory") && (!actor.managed || hasPermission(req,"stock.move")) ||
    actor.roles.some(r=>["sales","approver","finance","director"].includes(r)) &&
    (!actor.managed || hasPermission(req,"clients.read"))))
}
function allowedWrite(req:NextRequest) {
  return hasRole(req,"approver") &&
    (!currentActor(req)?.managed || ["sales.approve","clients.read"].every(k=>hasPermission(req,k)))
}

export async function GET(req:NextRequest){
  const denied=accessGate(req)
  if(denied)return denied
  if(!allowedRead(req))return NextResponse.json({error:"Lecture des OF réservée aux rôles habilités"},{status:403})
  const params=req.nextUrl.searchParams
  const rawOrderId=params.get("orderId")
  const orderId=rawOrderId===null?null:Number(rawOrderId)
  const inventory=hasRole(req,"inventory")
  if(rawOrderId!==null&&(!Number.isSafeInteger(orderId)||Number(orderId)<=0))
    return NextResponse.json({error:"Identifiant de commande invalide"},{status:400})
  if(!inventory&&orderId===null)return NextResponse.json({error:"Commande obligatoire"},{status:400})
  const take=Number(params.get("take")??(orderId!==null?"100":"50"))
  const skip=Number(params.get("skip")??"0")
  if(!Number.isSafeInteger(take)||take<1||take>100||!Number.isSafeInteger(skip)||skip<0||skip>10_000_000)
    return NextResponse.json({error:"Pagination des OF invalide"},{status:400})
  const where:Prisma.WorkOrderWhereInput=orderId!==null?{orderId}:{status:{in:["approved","in_progress","completed"]},order:{is:{fulfillmentStatus:"open",status:{notIn:["pending_validation","rejected","shipped"]}}}}
  const [total,rows]=await Promise.all([
    db.workOrder.count({where}),
    db.workOrder.findMany({where,include:{orderLine:{select:{qty:true,unit:true,productId:true,product:{select:{materialId:true}}}},finishedStockReceipts:{select:{qty:true}}},orderBy:{id:"desc"},skip,take}),
  ])
  const canReadClients=hasPermission(req,"clients.read")
  const items=rows.map(({orderLine,finishedStockReceipts,...row})=>workOrderDtoForViewer({
    ...row,productId:orderLine.productId,
    remainingToReceive:row.preparationKind==="manufacturing"&&orderLine.unit==="u"&&orderLine.product.materialId==null
      ? Math.max(0,orderLine.qty-finishedStockReceipts.reduce((n,l)=>n+l.qty,0)) : 0,
  },canReadClients)).filter(row=>!inventory||row.status!=="completed"||row.remainingToReceive>0)
  return NextResponse.json({items,pagination:{total,take,skip,hasMore:skip+rows.length<total}},
    {headers:{"Cache-Control":"private, no-store"}})
}

/** Réparation contrôlée d'anciennes commandes ; la création normale est désormais automatique. */
export async function POST(req:NextRequest){
  const denied=accessGate(req)
  if(denied)return denied
  if(!allowedWrite(req))return NextResponse.json({error:"Validation responsable habilité requise"},{status:403})
  const parsed=CreateSchema.safeParse(await req.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:"Ligne de commande invalide"},{status:400})
  const actor=currentActor(req)!.username
  try{
    const workOrder=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
      const line=await tx.orderLine.findUnique({where:{id:parsed.data.orderLineId},select:{orderId:true,kind:true,technicalSnapshotJson:true}})
      if(!line)throw new Error("LINE_NOT_FOUND")
      if(!lineRequiresWorkOrder(line.kind,line.technicalSnapshotJson))throw new Error("PREPARATION_NOT_REQUIRED")
      await createMissingWorkOrders(tx,line.orderId,actor)
      const found=await tx.workOrder.findUnique({where:{orderLineId:parsed.data.orderLineId}})
      if(!found)throw new Error("WORK_ORDER_MISSING")
      return {...found,snapshot:JSON.parse(found.snapshotJson)}
    }))
    return NextResponse.json({workOrder:workOrderDtoForViewer(workOrder,hasPermission(req,"clients.read"))},{status:201,headers:{"Cache-Control":"no-store"}})
  }catch(err){
    if(err instanceof Error && err.message==="LINE_NOT_FOUND")return NextResponse.json({error:"Ligne introuvable"},{status:404})
    if(err instanceof Error && err.message==="PREPARATION_NOT_REQUIRED")return NextResponse.json({error:"Aucun OF requis : ligne générique sans préparation"},{status:409})
    if(err instanceof Error && ["ORDER_NOT_ELIGIBLE","ORDER_NOT_APPROVED","PRODUCT_NOT_APPROVED","PIECES_INVALID","LINE_QUANTITY_INVALID"].includes(err.message))
      return NextResponse.json({error:"Commande ou pièces non éligibles : vérifier validation, stock, dimensions et statut"},{status:409})
    // La contrainte UNIQUE(orderLineId) reste le dernier verrou anti-doublon.
    if((err as {code?:string})?.code==="P2002")return NextResponse.json({error:"Un OF existe déjà pour cette ligne"},{status:409})
    console.error("Création OF refusée",safeErrorMetadata(err))
    return NextResponse.json({error:"Création OF impossible ; vérifier la migration et les journaux"},{status:409})
  }
}
