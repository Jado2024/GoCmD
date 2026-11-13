/**
 * VEN-01 : lots de produits finis suivis à l’unité, séparés des stocks matières.
 * Réception OF reliée exclusivement -> quarantaine -> qualité.
 * Jamais d’entrée automatique à la seule transition complete de l’OF.
 */
import {NextRequest,NextResponse} from "next/server"
import {z} from "zod"
import {accessGate,currentActor,hasRole,hasPermission} from "@/lib/access-gate"
import {db} from "@/lib/db"
import {serializedSQLiteWrite} from "@/lib/sqlite-write"

export const dynamic="force-dynamic"
const positive=z.number().int().positive().max(100000)
const receive=z.object({action:z.literal("receive"),productId:positive,
  lotCode:z.string().trim().min(3).max(80),qty:positive,
  sourceRef:z.string().trim().min(3).max(150).optional(),workOrderId:positive.optional(),expiresAt:z.string().datetime().optional(),replacementLotId:positive.optional(),reworkApprovalId:positive.optional(),replacementReason:z.string().trim().min(10).max(500).optional()}).strict()
const decide=z.object({action:z.enum(["release","reject"]),lotId:positive,
  reason:z.string().trim().min(10).max(500)}).strict()
function error(message:string,status:number){return NextResponse.json({error:message},{status})}
function mayInventory(req:NextRequest){return hasRole(req,"inventory")&&(!currentActor(req)?.managed||hasPermission(req,"stock.move"))}
function mayQuality(req:NextRequest){return hasRole(req,"quality")&&(!currentActor(req)?.managed||hasPermission(req,"quality.manage"))}
async function ref(tx:import("@prisma/client").Prisma.TransactionClient){
  const year=new Date().getUTCFullYear()
  const key=`FINISHED_STOCK:${year}`
  const sequence=await tx.salesDocCounter.upsert({where:{id:key},create:{id:key,value:1},update:{value:{increment:1}}})
  return `MFP-${year}-${String(sequence.value).padStart(6,"0")}`
}
export async function GET(req:NextRequest){
  const denied=accessGate(req);if(denied)return denied
  if(!mayInventory(req)&&!mayQuality(req)&&!hasRole(req,"sales"))return error("Accès stock réservé",403)
  if(req.nextUrl.searchParams.get("pending")==="1"){
    if(!mayQuality(req))return error("Contrôle qualité réservé",403)
    const lots=await db.finishedStockLot.findMany({where:{status:"quarantine"},include:{product:{select:{sku:true,name:true,unit:true}}},orderBy:{receivedAt:"asc"},take:100})
    return NextResponse.json({items:lots},{headers:{"Cache-Control":"private, no-store"}})
  }
  const id=Number(req.nextUrl.searchParams.get("productId"))
  if(!Number.isSafeInteger(id)||id<=0)return error("Produit invalide",400)
  const lots=await db.finishedStockLot.findMany({where:{productId:id},orderBy:[{status:"asc"},{receivedAt:"asc"}],take:200})
  return NextResponse.json({items:lots},{headers:{"Cache-Control":"private, no-store"}})
}
export async function POST(req:NextRequest){
  const denied=accessGate(req);if(denied)return denied
  const raw=await req.json().catch(()=>null)
  const actor=currentActor(req)!.username
  const received=receive.safeParse(raw)
  const decision=decide.safeParse(raw)
  if(!received.success&&!decision.success)return error("Réception ou décision qualité invalide",400)
  if(received.success&&!mayInventory(req))return error("Habilitation magasin requise",403)
  if(decision.success&&!mayQuality(req))return error("Habilitation qualité requise",403)
  try {
    const item=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
      // Verrou SQLite ecriture en amont des controles de cumuls,
      // y compris lorsque deux serveurs traitent des receptions paralleles.
      await tx.salesDocCounter.upsert({where:{id:'GOCMD_FINISHED_RECEIPT_LOCK'},create:{id:'GOCMD_FINISHED_RECEIPT_LOCK',value:1},update:{value:{increment:1}}})
      if(received.success){
        const d=received.data
        const p=await tx.product.findUnique({where:{id:d.productId}})
        if(!p||p.unit!=="u"||p.materialId!=null||p.status!=="active")
          throw Error("PRODUCT_NOT_ELIGIBLE")
        let sourceRef=d.sourceRef??null
        if(d.workOrderId){
          const wo=await tx.workOrder.findUnique({where:{id:d.workOrderId},include:{orderLine:true}})
          if(!wo||wo.status!=="completed"||wo.preparationKind!=="manufacturing"||wo.orderLine.productId!==p.id||wo.orderLine.unit!=="u"||!Number.isSafeInteger(wo.orderLine.qty))
            throw Error("OF_NOT_ELIGIBLE")
          // Historique immuable : ne PAS compter FinishedStockLot.qty, réduit au BL.
          const already=await tx.finishedStockMovement.aggregate({where:{type:"received_quarantine",lot:{workOrderId:wo.id}},_sum:{qty:true}})
          const active=await tx.finishedStockMovement.aggregate({where:{type:'received_quarantine',lot:{workOrderId:wo.id,status:{in:['quarantine','available','exhausted']}}},_sum:{qty:true}})
          if((active._sum.qty??0)+d.qty>wo.orderLine.qty)throw Error("OF_OVER_RECEIPT")
          if((already._sum.qty??0)+d.qty>wo.orderLine.qty){
            if(!d.replacementLotId||!d.replacementReason||!d.reworkApprovalId)throw Error('REPLACEMENT_TRACE_REQUIRED')
            const rejected=await tx.finishedStockLot.findUnique({where:{id:d.replacementLotId}})
            if(!rejected||rejected.workOrderId!==wo.id||rejected.status!=='rejected')throw Error('REPLACEMENT_SOURCE_INVALID')
            const approval=await tx.productionReworkApproval.findUnique({where:{id:d.reworkApprovalId}})
            if(!approval||approval.sourceKind!=='finished_lot'||approval.sourceId!==rejected.id||approval.productionRef!==wo.ref||approval.approvedBy===actor)throw Error('REWORK_NOT_APPROVED')
            const used=await tx.productionReworkApproval.updateMany({where:{id:approval.id,usedQty:{lte:approval.qty-d.qty+1e-6}},data:{usedQty:{increment:d.qty}}})
            if(used.count!==1)throw Error('REWORK_CAP_EXCEEDED')
          }else if(d.replacementLotId||d.replacementReason||d.reworkApprovalId)throw Error('UNNECESSARY_REPLACEMENT')
          sourceRef=wo.ref
        }
        // Provenances autorisées : OF client terminé OU DPR avec OF-MTS terminé.
        // Une sourceRef libre (« TEST », etc.) ne crée jamais du stock.
        if(!d.workOrderId){
          if(!sourceRef?.startsWith('DPR-'))throw Error('SOURCE_NOT_APPROVED')
          const request=await tx.productionReplenishmentRequest.findUnique({where:{ref:sourceRef},include:{stockOrder:true}})
          if(!request||request.status!=='approved'||request.productId!==p.id||request.unit!=='u'||request.stockOrder?.status!=='completed')throw Error('PRODUCTION_REQUEST_INVALID')
          const already=await tx.finishedStockMovement.aggregate({where:{type:'received_quarantine',lot:{productId:p.id,sourceRef}},_sum:{qty:true}})
          const active=await tx.finishedStockMovement.aggregate({where:{type:'received_quarantine',lot:{productId:p.id,sourceRef,status:{in:['quarantine','available','exhausted']}}},_sum:{qty:true}})
          if((active._sum.qty??0)+d.qty>request.qty)throw Error('PRODUCTION_REQUEST_OVER_RECEIPT')
          if((already._sum.qty??0)+d.qty>request.qty){
            if(!d.replacementLotId||!d.replacementReason||!d.reworkApprovalId)throw Error('REPLACEMENT_TRACE_REQUIRED')
            const rejected=await tx.finishedStockLot.findUnique({where:{id:d.replacementLotId}})
            if(!rejected||rejected.productId!==p.id||rejected.sourceRef!==sourceRef||rejected.status!=='rejected')throw Error('REPLACEMENT_SOURCE_INVALID')
            const approval=await tx.productionReworkApproval.findUnique({where:{id:d.reworkApprovalId}})
            if(!approval||approval.sourceKind!=='finished_lot'||approval.sourceId!==rejected.id||approval.productionRef!==sourceRef||approval.approvedBy===actor)throw Error('REWORK_NOT_APPROVED')
            const used=await tx.productionReworkApproval.updateMany({where:{id:approval.id,usedQty:{lte:approval.qty-d.qty+1e-6}},data:{usedQty:{increment:d.qty}}})
            if(used.count!==1)throw Error('REWORK_CAP_EXCEEDED')
          }else if(d.replacementLotId||d.replacementReason||d.reworkApprovalId)throw Error('UNNECESSARY_REPLACEMENT')
        }
        const expiry=d.expiresAt?new Date(d.expiresAt):null
        if(expiry && expiry<=new Date())throw Error("EXPIRED_LOT")
        if(sourceRef==null)throw Error("SOURCE_NOT_APPROVED")
        const lot=await tx.finishedStockLot.create({data:{productId:d.productId,lotCode:d.lotCode,
          qty:d.qty,status:"quarantine",sourceRef,workOrderId:d.workOrderId??null,receivedBy:actor,expiresAt:expiry}})
        await tx.finishedStockMovement.create({data:{ref:await ref(tx),lotId:lot.id,type:"received_quarantine",qty:d.qty,document:sourceRef,actor}})
        await tx.auditEvent.create({data:{actor,action:"FINISHED_STOCK_RECEIVED_QUARANTINE",entity:"FinishedStockLot",entityId:String(lot.id),
          details:JSON.stringify({productId:p.id,lotCode:d.lotCode,qty:d.qty,sourceRef,workOrderId:d.workOrderId??null,replacementLotId:d.replacementLotId??null,reworkApprovalId:d.reworkApprovalId??null,replacementReason:d.replacementReason??null})}})
        return lot
      }
      if(!decision.success)throw Error("INVALID")
      const d=decision.data
      const lot=await tx.finishedStockLot.findUnique({where:{id:d.lotId}})
      if(!lot||lot.status!=="quarantine")throw Error("LOT_NOT_QUARANTINED")
      if(lot.receivedBy===actor)throw Error("SELF_QUALITY_APPROVAL")
      // For stock manufacturing, quality must also differ from the production
      // approver who created the OF, even if a user holds multiple roles.
      if(lot.sourceRef.startsWith('DPR-')){
        const planned=await tx.productionReplenishmentRequest.findUnique({where:{ref:lot.sourceRef},include:{stockOrder:true}})
        if(!planned?.stockOrder||planned.stockOrder.createdBy===actor||planned.createdBy===actor)throw Error('SELF_QUALITY_APPROVAL')
      }
      if(d.action==="release"&&lot.expiresAt&&lot.expiresAt<=new Date())throw Error("EXPIRED_LOT")
      const status=d.action==="release"?"available":"rejected"
      const changed=await tx.finishedStockLot.updateMany({where:{id:d.lotId,status:"quarantine"},data:{status,qualityBy:actor}})
      if(changed.count!==1)throw Error("CONFLICT")
      await tx.finishedStockMovement.create({data:{ref:await ref(tx),lotId:lot.id,type:status,qty:0,document:d.reason,actor}})
      await tx.auditEvent.create({data:{actor,action:`FINISHED_STOCK_${status.toUpperCase()}`,entity:"FinishedStockLot",entityId:String(lot.id),
        details:JSON.stringify({lotCode:lot.lotCode,reason:d.reason})}})
      return tx.finishedStockLot.findUniqueOrThrow({where:{id:lot.id}})
    }))
    return NextResponse.json({lot:item},{status:received.success?201:200})
  }catch(err){
    if(err instanceof Error && ['PRODUCTION_REQUEST_INVALID','PRODUCTION_REQUEST_OVER_RECEIPT'].includes(err.message))return error('Demande de fabrication de stock non validee ou quantite depassee',409)
    if(err instanceof Error && err.message==='SOURCE_NOT_APPROVED')return error('Source de stock inconnue : OF client ou OF stock termine obligatoire',403)
    if(err instanceof Error && err.message==="OF_NOT_ELIGIBLE")return error("OF non termine, non fabrique ou produit incompatible",409)
    if(err instanceof Error && err.message==="OF_OVER_RECEIPT")return error("Quantite cumulee recue superieure a la quantite de l OF",409)
    if(err instanceof Error && ["SELF_QUALITY_APPROVAL"].includes(err.message))return error("Contrôle à quatre yeux : une autre personne doit libérer le lot",403)
    if(err instanceof Error && ['REPLACEMENT_TRACE_REQUIRED','REPLACEMENT_SOURCE_INVALID','UNNECESSARY_REPLACEMENT','REWORK_NOT_APPROVED','REWORK_CAP_EXCEEDED'].includes(err.message))return error('Remplacement exige un lot rejete du meme ordre et une justification',409)
    return error("Lot non admissible, réception dupliquée ou conflit de validation",409)
  }
}
