/** VEN-03 — retour CLIENT physique : BL -> déclaration -> réception -> qualité.
 * Ne produit pas automatiquement d'avoir ni remboursement. Les stocks matières
 * repris au client ne sont jamais réintégrés sans processus de magasin validé.
 */
import {NextRequest,NextResponse} from "next/server"
import {z} from "zod"
import {accessGate,currentActor,hasRole,hasPermission} from "@/lib/access-gate"
import {db} from "@/lib/db"
import {serializedSQLiteWrite} from "@/lib/sqlite-write"
import {isValidPurchaseQuantity} from "@/lib/purchase-quantity"
import type {Prisma} from "@prisma/client"

export const dynamic="force-dynamic"
const id=z.number().int().positive()
const request=z.object({action:z.literal("request"),deliveryLineId:id,
  qty:z.number().finite().positive().max(1_000_000),
  pieceIds:z.array(id).max(1000).default([]),
  requestKey:z.string().uuid(),reason:z.string().trim().min(10).max(500)}).strict()
const transition=z.object({action:z.enum(["receive","accept","reject"]),returnId:id,
  reason:z.string().trim().min(10).max(500)}).strict()
const bad=(error:string,status=400)=>NextResponse.json({error},{status})
function authorized(req:NextRequest,role:"sales"|"receiver"|"quality",permission:string){
  return hasRole(req,role)&&(!currentActor(req)?.managed||hasPermission(req,permission))
}
async function next(tx:Prisma.TransactionClient,prefix:string){
  const year=new Date().getUTCFullYear()
  const s=await tx.salesDocCounter.upsert({where:{id:`${prefix}:${year}`},create:{id:`${prefix}:${year}`,value:1},update:{value:{increment:1}}})
  return `${prefix}-${year}-${String(s.value).padStart(5,"0")}`
}
const audit=(actor:string,action:string,entityId:number,details:unknown)=>({actor,action,entity:"CustomerReturn",entityId:String(entityId),details:JSON.stringify(details)})
export async function GET(req:NextRequest){
  const denied=accessGate(req);if(denied)return denied
  if(!hasRole(req,"sales")&&!hasRole(req,"receiver")&&!hasRole(req,"quality")&&!hasRole(req,"finance"))return bad("Accès retours interdit",403)
  const deliveryId=req.nextUrl.searchParams.get("deliveryLineId")
  const filter=deliveryId?Number(deliveryId):undefined
  if(deliveryId&&(!Number.isSafeInteger(filter)||!filter||filter<1))return bad("Ligne BL invalide")
  const items=await db.customerReturn.findMany({where:filter?{deliveryLineId:filter}:{},orderBy:{id:"desc"},take:100})
  return NextResponse.json({items},{headers:{"Cache-Control":"private, no-store"}})
}
export async function POST(req:NextRequest){
  const denied=accessGate(req);if(denied)return denied
  const data=await req.json().catch(()=>null)
  const actor=currentActor(req)!.username
  const parsed=request.safeParse(data)
  const action=transition.safeParse(data)
  if(!parsed.success&&!action.success)return bad("Retour client invalide")
  if(parsed.success&&!authorized(req,"sales","sales.deliveries"))return bad("Habilitation commercial requise",403)
  if(action.success&&action.data.action==="receive"&&!authorized(req,"receiver","receipts.create"))return bad("Habilitation réception requise",403)
  if(action.success&&action.data.action!=="receive"&&!authorized(req,"quality","quality.manage"))return bad("Habilitation qualité requise",403)
  try{
    const item=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
      if(parsed.success){
        const d=parsed.data
        // Jeton d'idempotence : une requête rejouée ne crée pas de deuxième retour.
        const existing=await tx.customerReturn.findUnique({where:{requestKey:d.requestKey}})
        if(existing){
          if(existing.deliveryLineId!==d.deliveryLineId||existing.qty!==d.qty||existing.pieceIdsJson!==JSON.stringify(d.pieceIds)||existing.reason!==d.reason)
            throw Error("REPLAY_MISMATCH")
          return existing
        }
        const dl=await tx.salesDeliveryLine.findUnique({where:{id:d.deliveryLineId},include:{orderLine:{include:{product:true,pieces:true}}}})
        if(!dl)throw Error("DELIVERY_NOT_FOUND")
        if(!isValidPurchaseQuantity(d.qty,dl.unit))throw Error("INVALID_QUANTITY")
        const shipped=JSON.parse(dl.pieceIds) as number[]
        const all=await tx.customerReturn.findMany({where:{deliveryLineId:dl.id}})
        const returnedQty=all.reduce((s,r)=>s+r.qty,0)
        if(returnedQty+d.qty>dl.qty+1e-7)throw Error("OVER_RETURN")
        if(shipped.length){
          if(d.pieceIds.length!==new Set(d.pieceIds).size||!d.pieceIds.length||d.pieceIds.some(pid=>!shipped.includes(pid)))throw Error("INVALID_PIECES")
          const prior=new Set(all.flatMap(r=>JSON.parse(r.pieceIdsJson) as number[]))
          if(d.pieceIds.some(pid=>prior.has(pid)))throw Error("DUPLICATE_PIECE_RETURN")
          const available=dl.orderLine.pieces.filter(p=>d.pieceIds.includes(p.id))
          const qty=dl.unit==="ml"?available.reduce((s,p)=>s+(p.linearMeters??0),0):available.length
          if(Math.abs(qty-d.qty)>1e-5)throw Error("PIECES_QUANTITY_MISMATCH")
        }else if(d.pieceIds.length)throw Error("INVALID_PIECES")
        const ret=await tx.customerReturn.create({data:{ref:await next(tx,"RCL"),deliveryLineId:dl.id,qty:d.qty,unit:dl.unit,
          pieceIdsJson:JSON.stringify(d.pieceIds),requestKey:d.requestKey,reason:d.reason,createdBy:actor}})
        await tx.auditEvent.create({data:audit(actor,"CUSTOMER_RETURN_REQUESTED",ret.id,{deliveryLineId:dl.id,qty:d.qty,pieceIds:d.pieceIds})})
        return ret
      }
      if(!action.success)throw Error("INVALID")
      const d=action.data
      const ret=await tx.customerReturn.findUnique({where:{id:d.returnId},include:{deliveryLine:{include:{orderLine:{include:{product:true}}}}}})
      if(!ret)throw Error("RETURN_NOT_FOUND")
      if(d.action==="receive"){
        if(ret.status!=="requested")throw Error("INVALID_STATE")
        if(actor===ret.createdBy)throw Error("SELF_RECEIPT")
        let finishedStockLotId:number|null=null
        const p=ret.deliveryLine.orderLine.product
        if(p.family==="MATELAS"&&p.unit==="u"&&p.materialId==null){
          // Lot retourné physiquement en QUARANTAINE, non vendable.
          const lot=await tx.finishedStockLot.create({data:{productId:p.id,lotCode:`RETOUR-${ret.ref}`,qty:Math.round(ret.qty),
            status:"quarantine",sourceRef:ret.ref,receivedBy:actor}})
          await tx.finishedStockMovement.create({data:{ref:await next(tx,"MFP"),lotId:lot.id,type:"received_quarantine",qty:Math.round(ret.qty),document:ret.ref,actor}})
          finishedStockLotId=lot.id
        }
        const changed=await tx.customerReturn.updateMany({where:{id:ret.id,status:"requested"},data:{status:"quarantine",receivedBy:actor,receivedAt:new Date(),finishedStockLotId}})
        if(changed.count!==1)throw Error("CONFLICT")
        await tx.auditEvent.create({data:audit(actor,"CUSTOMER_RETURN_RECEIVED",ret.id,{reason:d.reason,finishedStockLotId})})
      }else{
        if(ret.status!=="quarantine"||!ret.receivedBy)throw Error("INVALID_STATE")
        if(ret.receivedBy===actor||ret.createdBy===actor)throw Error("SELF_QUALITY")
        const status=d.action==="accept"?"accepted":"rejected"
        if(ret.finishedStockLotId){
          const changedLot=await tx.finishedStockLot.updateMany({where:{id:ret.finishedStockLotId,status:"quarantine"},data:{status:status==="accepted"?"available":"rejected",qualityBy:actor}})
          if(changedLot.count!==1)throw Error("CONFLICT")
          await tx.finishedStockMovement.create({data:{ref:await next(tx,"MFP"),lotId:ret.finishedStockLotId,
            type:status==="accepted"?"available":"rejected",qty:0,document:ret.ref,actor}})
        }
        const changed=await tx.customerReturn.updateMany({where:{id:ret.id,status:"quarantine"},data:{status,qualityBy:actor,qualityAt:new Date(),qualityReason:d.reason}})
        if(changed.count!==1)throw Error("CONFLICT")
        await tx.auditEvent.create({data:audit(actor,"CUSTOMER_RETURN_QUALITY_"+status.toUpperCase(),ret.id,
          {reason:d.reason,stockReintegrated:status==="accepted"&&ret.finishedStockLotId!=null})})
      }
      return tx.customerReturn.findUniqueOrThrow({where:{id:d.returnId}})
    }))
    return NextResponse.json({return:item,financialAction:"Aucun avoir ni remboursement automatique ; validation finance distincte.",
      stockAction:item.status==="accepted"&&!item.finishedStockLotId?"Article repris non réintégré automatiquement au stock matière":undefined},
      {status:parsed.success?201:200})
  }catch(err){
    const code=err instanceof Error?err.message:""
    if(code==="SELF_QUALITY"||code==="SELF_RECEIPT")return bad("Séparation des tâches : intervenant distinct requis",403)
    return bad("Retour refusé : quantité, pièces, état ou doublon incompatible",409)
  }
}
