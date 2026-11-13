/** Reception et visa qualite de MATIERES fabriquees pour stock : pas de BR fictif. */
import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {db} from '@/lib/db'
import {accessGate,currentActor,hasRole,hasPermission} from '@/lib/access-gate'
import {serializedSQLiteWrite} from '@/lib/sqlite-write'
import {requiresInternalManufacturing,isValidStockQuantity} from '@/lib/stock-quantity'
import {placeReceipt,movePlacement} from '@/lib/p2p-placements'
import {nextRef} from '@/lib/erp-server'
import {receivedWeightedAverageCost} from '@/lib/stock-cost'
export const dynamic='force-dynamic'
const receive=z.object({action:z.literal('receive'),stockOrderId:z.number().int().positive(),lotCode:z.string().trim().min(3).max(80),qty:z.number().positive().finite(),expiresAt:z.string().datetime().optional(),replacementReceiptId:z.number().int().positive().optional(),reworkApprovalId:z.number().int().positive().optional(),replacementReason:z.string().trim().min(10).max(500).optional()}).strict()
const decide=z.object({action:z.enum(['release','reject']),receiptId:z.number().int().positive(),reason:z.string().trim().min(10).max(500)}).strict()
function allowed(req:NextRequest,role:'inventory'|'quality',permission:string){return hasRole(req,role)&&(!currentActor(req)?.managed||hasPermission(req,permission))}
function bad(text:string,status=409){return NextResponse.json({error:text},{status,headers:{'Cache-Control':'no-store'}})}
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 if(!allowed(req,'quality','quality.manage')&&!allowed(req,'inventory','stock.move')&&!hasRole(req,'production'))return bad('Acces refuse',403)
 const take=Math.min(100,Math.max(1,Number(req.nextUrl.searchParams.get('take'))||50))
 const before=Number(req.nextUrl.searchParams.get('before'))
 const status=req.nextUrl.searchParams.get('status')==='rejected'?'rejected':'quarantine'
 const records=await db.productionMaterialReceipt.findMany({where:{status,...(Number.isSafeInteger(before)&&before>0?{id:{lt:before}}:{})},include:{stockOrder:{select:{ref:true,createdBy:true,request:{select:{ref:true,materialId:true,qty:true,unit:true}}}},stockLot:{select:{lotCode:true}}},orderBy:{id:'desc'},take})
 return NextResponse.json({items:records,nextBefore:records.length===take?records.at(-1)?.id:null},{headers:{'Cache-Control':'private, no-store'}})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 const data=await req.json().catch(()=>null)
 const rec=receive.safeParse(data),decision=decide.safeParse(data)
 if(!rec.success&&!decision.success)return bad('Reception ou decision invalide',400)
 if(rec.success&&!allowed(req,'inventory','stock.move'))return bad('Reception reservee au magasinier',403)
 if(decision.success&&!allowed(req,'quality','quality.manage'))return bad('Decision reservee a la qualite',403)
 const actor=currentActor(req)!.username
 try{
  const result=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   await tx.salesDocCounter.upsert({where:{id:'GOCMD_MTS_RECEIPT_LOCK'},create:{id:'GOCMD_MTS_RECEIPT_LOCK',value:1},update:{value:{increment:1}}})
   if(rec.success){
    const d=rec.data
    const wo=await tx.productionStockOrder.findUnique({where:{id:d.stockOrderId},include:{request:{include:{material:true}}}})
    const request=wo?.request,material=request?.material
    if(!wo||wo.status!=='completed'||request?.status!=='approved'||!material||!(material.isManufactured||requiresInternalManufacturing(material)))throw Error('NOT_ELIGIBLE')
    if(!isValidStockQuantity(d.qty,material.unit))throw Error('INVALID_UNIT')
    const active=await tx.productionMaterialReceipt.aggregate({where:{stockOrderId:wo.id,status:{in:['quarantine','released']}},_sum:{qty:true}})
    if((active._sum.qty??0)+d.qty>request.qty+1e-6)throw Error('OVER_RECEIPT')
    const historic=await tx.productionMaterialReceipt.aggregate({where:{stockOrderId:wo.id},_sum:{qty:true}})
    const replacing=(historic._sum.qty??0)+d.qty>request.qty+1e-6
    if(replacing){
      if(!d.replacementReceiptId||!d.replacementReason||!d.reworkApprovalId)throw Error('REPLACEMENT_TRACE_REQUIRED')
      const rejected=await tx.productionMaterialReceipt.findUnique({where:{id:d.replacementReceiptId}})
      if(!rejected||rejected.stockOrderId!==wo.id||rejected.status!=='rejected')throw Error('REPLACEMENT_SOURCE_INVALID')
      const approval=await tx.productionReworkApproval.findUnique({where:{id:d.reworkApprovalId}})
      if(!approval||approval.sourceKind!=='material_receipt'||approval.sourceId!==rejected.id||approval.productionRef!==wo.ref||approval.approvedBy===actor)throw Error('REWORK_NOT_APPROVED')
      const used=await tx.productionReworkApproval.updateMany({where:{id:approval.id,usedQty:{lte:approval.qty-d.qty+1e-6}},data:{usedQty:{increment:d.qty}}})
      if(used.count!==1)throw Error('REWORK_CAP_EXCEEDED')
    }else if(d.replacementReceiptId||d.replacementReason||d.reworkApprovalId)throw Error('UNNECESSARY_REPLACEMENT')
    const expiry=d.expiresAt?new Date(d.expiresAt):null
    if(expiry&&expiry<=new Date())throw Error('EXPIRED')
    const lot=await tx.stockLot.create({data:{materialId:material.id,lotCode:d.lotCode,status:'quarantine',qty:d.qty,provenanceKey:`MTS-${wo.id}`,expiresAt:expiry}})
    await placeReceipt(tx,lot.id,d.qty)
    const receipt=await tx.productionMaterialReceipt.create({data:{stockOrderId:wo.id,stockLotId:lot.id,qty:d.qty,receivedBy:actor}})
    await tx.auditEvent.create({data:{actor,action:'MTS_MATERIAL_RECEIVED_QUARANTINE',entity:'ProductionMaterialReceipt',entityId:String(receipt.id),details:JSON.stringify({ref:wo.ref,request:request.ref,qty:d.qty,unit:material.unit,lot:lot.lotCode,replacementReceiptId:d.replacementReceiptId??null,reworkApprovalId:d.reworkApprovalId??null,replacementReason:d.replacementReason??null})}})
    return receipt
   }
   if(!decision.success)throw Error('BAD_REQUEST')
   const d=decision.data
   const receipt=await tx.productionMaterialReceipt.findUnique({where:{id:d.receiptId},include:{stockLot:true,stockOrder:{include:{request:true}}}})
   if(!receipt||receipt.status!=='quarantine'||receipt.stockLot.status!=='quarantine'||receipt.stockOrder.request.status!=='approved')throw Error('BAD_STATUS')
   if(receipt.receivedBy===actor||receipt.stockOrder.createdBy===actor||receipt.stockOrder.request.createdBy===actor)throw Error('SELF_APPROVAL')
   if(d.action==='release'&&receipt.stockLot.expiresAt&&receipt.stockLot.expiresAt<=new Date())throw Error('EXPIRED')
   // A finance-approved standard manufacturing cost is required: never silently
   // reuse the supplier purchase price as manufacturing cost.
   const cost=d.action==='release'?await tx.productionMaterialCostApproval.findUnique({where:{stockOrderId:receipt.stockOrderId}}):null
   if(d.action==='release'&&!cost)throw Error('MTS_COST_NOT_APPROVED')
   const status=d.action==='release'?'released':'rejected'
   const now=new Date()
   await tx.productionMaterialReceipt.update({where:{id:receipt.id},data:{status,decidedBy:actor,decidedAt:now,reason:d.reason}})
   if(d.action==='release'){
    // Suivre le precedent quality-inspections : changer de lot ET de placement.
    await tx.stockLot.update({where:{id:receipt.stockLotId},data:{qty:0,status:'exhausted'}})
    const accepted=await tx.stockLot.upsert({where:{materialId_lotCode_status_provenanceKey:{materialId:receipt.stockLot.materialId,lotCode:receipt.stockLot.lotCode,status:'available',provenanceKey:receipt.stockLot.provenanceKey}},create:{materialId:receipt.stockLot.materialId,lotCode:receipt.stockLot.lotCode,qty:receipt.qty,status:'available',provenanceKey:receipt.stockLot.provenanceKey,receivedAt:receipt.stockLot.receivedAt,expiresAt:receipt.stockLot.expiresAt},update:{qty:{increment:receipt.qty}}})
    await movePlacement(tx,receipt.stockLotId,accepted.id,receipt.qty)
    const material=await tx.material.findUniqueOrThrow({where:{id:receipt.stockLot.materialId}})
    const average=receivedWeightedAverageCost(material.stockQty,material.averageCost===null?null:Number(material.averageCost),material.unitPrice,receipt.qty,Number(cost!.unitCost))
    await tx.material.update({where:{id:receipt.stockLot.materialId},data:{stockQty:{increment:receipt.qty},averageCost:average}})
    const ref=await nextRef('MVT','movement',tx)
    await tx.movement.create({data:{ref,type:'in',materialId:receipt.stockLot.materialId,stockLotId:accepted.id,qty:receipt.qty,signedQty:receipt.qty,unit:receipt.stockOrder.request.unit,document:receipt.stockOrder.request.ref,reason:`Reception fabrication MTS ${receipt.stockOrder.ref} - cout standard MAD ${String(cost!.unitCost)} - qualite ${d.reason}`,operator:actor}})
   }else{
    await tx.stockLot.update({where:{id:receipt.stockLotId},data:{status:'returned'}})
   }
   await tx.qualityInspection.create({data:{materialId:receipt.stockLot.materialId,stockLotId:receipt.stockLotId,decision:d.action,qty:receipt.qty,reason:d.reason,actor}})
   await tx.auditEvent.create({data:{actor,action:`MTS_MATERIAL_${status.toUpperCase()}`,entity:'ProductionMaterialReceipt',entityId:String(receipt.id),details:JSON.stringify({ref:receipt.stockOrder.ref,qty:receipt.qty,reason:d.reason})}})
   return tx.productionMaterialReceipt.findUniqueOrThrow({where:{id:receipt.id}})
  }))
  return NextResponse.json({receipt:result},{status:rec.success?201:200,headers:{'Cache-Control':'no-store'}})
 }catch(e){const code=e instanceof Error?e.message:'UNKNOWN';return bad(code==='SELF_APPROVAL'?'Controle a quatre yeux obligatoire':code==='OVER_RECEIPT'?'Quantite totale recue depasse l OF':code==='INVALID_UNIT'?'Unite ou quantite non valide':code==='MTS_COST_NOT_APPROVED'?'Cout de fabrication MAD non valide par la finance':code.startsWith('REPLACEMENT_')||code.startsWith('REWORK_')||code==='UNNECESSARY_REPLACEMENT'?'Reprise de fabrication non justifiee ou non tracee':`Operation refusee (${code})`,code==='SELF_APPROVAL'?403:409)}
}
