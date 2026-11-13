/** Rework is a separate, authorized production decision after a recorded quality reject.
 * No automatic refabrication. One bounded approval per rejected source. */
import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {accessGate,hasRole,hasPermission,currentActor} from '@/lib/access-gate'
import {db} from '@/lib/db'
import {serializedSQLiteWrite} from '@/lib/sqlite-write'
export const dynamic='force-dynamic'
const input=z.object({sourceKind:z.enum(['material_receipt','finished_lot']),sourceId:z.number().int().positive(),reason:z.string().trim().min(10).max(500)}).strict()
function allowed(req:NextRequest){return hasRole(req,'production')&&(!currentActor(req)?.managed||hasPermission(req,'production.approve'))}
function bad(message:string,status=409){return NextResponse.json({error:message},{status,headers:{'Cache-Control':'no-store'}})}
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 if(!allowed(req)&&!hasRole(req,'inventory'))return bad('Acces refuse',403)
 const take=Math.min(100,Math.max(1,Number(req.nextUrl.searchParams.get('take'))||50))
 const [materials,finished,approvals]=await Promise.all([
   db.productionMaterialReceipt.findMany({where:{status:'rejected'},select:{id:true,qty:true,receivedBy:true,decidedBy:true,stockOrder:{select:{ref:true,request:{select:{unit:true}}}}},orderBy:{id:'desc'},take}),
   db.finishedStockLot.findMany({where:{status:'rejected'},select:{id:true,qty:true,sourceRef:true,receivedBy:true,qualityBy:true,product:{select:{unit:true,sku:true}}},orderBy:{id:'desc'},take}),
   db.productionReworkApproval.findMany({orderBy:{id:'desc'},take:take*2})
 ])
 return NextResponse.json({sources:[...materials.map(x=>({kind:'material_receipt',id:x.id,qty:x.qty,productionRef:x.stockOrder.ref,unit:x.stockOrder.request.unit,receivedBy:x.receivedBy,decidedBy:x.decidedBy})),...finished.map(x=>({kind:'finished_lot',id:x.id,qty:x.qty,productionRef:x.sourceRef,unit:x.product.unit,receivedBy:x.receivedBy,decidedBy:x.qualityBy}))],approvals},{headers:{'Cache-Control':'private, no-store'}})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 if(!allowed(req))return bad('Autorisation reservee au responsable production',403)
 const parsed=input.safeParse(await req.json().catch(()=>null));if(!parsed.success)return bad('Source rejetee et justification obligatoires',400)
 const d=parsed.data,actor=currentActor(req)!.username
 try{
  const approval=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
    await tx.salesDocCounter.upsert({where:{id:'GOCMD_MTS_REWORK_LOCK'},create:{id:'GOCMD_MTS_REWORK_LOCK',value:1},update:{value:{increment:1}}})
    let ref:string,qty:number,unit:string,receivedBy:string,decidedBy:string|null
    if(d.sourceKind==='material_receipt'){
      const source=await tx.productionMaterialReceipt.findUnique({where:{id:d.sourceId},include:{stockOrder:{include:{request:true}}}})
      if(!source||source.status!=='rejected'||source.stockOrder.request.status!=='approved'||source.stockOrder.status!=='completed')throw Error('NOT_ELIGIBLE')
      ref=source.stockOrder.ref;qty=source.qty;unit=source.stockOrder.request.unit;receivedBy=source.receivedBy;decidedBy=source.decidedBy
    }else{
      const source=await tx.finishedStockLot.findUnique({where:{id:d.sourceId},include:{product:true}})
      if(!source||source.status!=='rejected')throw Error('NOT_ELIGIBLE')
      if(source.sourceRef.startsWith('DPR-')){
        const request=await tx.productionReplenishmentRequest.findUnique({where:{ref:source.sourceRef},include:{stockOrder:true}})
        if(!request||request.status!=='approved'||request.stockOrder?.status!=='completed')throw Error('NOT_ELIGIBLE')
      }else{
        if(!source.workOrderId)throw Error('NOT_ELIGIBLE')
        const wo=await tx.workOrder.findUnique({where:{id:source.workOrderId}})
        if(!wo||wo.status!=='completed')throw Error('NOT_ELIGIBLE')
      }
      ref=source.sourceRef;qty=source.qty;unit=source.product.unit;receivedBy=source.receivedBy;decidedBy=source.qualityBy??null
    }
    if(actor===receivedBy||actor===decidedBy)throw Error('SELF_APPROVAL')
    const seq=await tx.salesDocCounter.upsert({where:{id:'GOCMD_MTS_REWORK_SEQUENCE'},create:{id:'GOCMD_MTS_REWORK_SEQUENCE',value:1},update:{value:{increment:1}}})
    const number=`REOF-${new Date().getUTCFullYear()}-${String(seq.value).padStart(6,'0')}`
    const result=await tx.productionReworkApproval.create({data:{ref:number,sourceKind:d.sourceKind,sourceId:d.sourceId,productionRef:ref,qty,unit,approvedBy:actor,reason:d.reason}})
    await tx.auditEvent.create({data:{actor,action:'MTS_REWORK_APPROVED',entity:'ProductionReworkApproval',entityId:String(result.id),details:JSON.stringify({ref:number,sourceKind:d.sourceKind,sourceId:d.sourceId,productionRef:ref,qty,unit,reason:d.reason})}})
    return result
  }))
  return NextResponse.json({approval},{status:201,headers:{'Cache-Control':'no-store'}})
 }catch(e){const c=e instanceof Error?e.message:'UNKNOWN';return bad(c==='SELF_APPROVAL'?'Validation de reprise par un responsable distinct requise':c==='NOT_ELIGIBLE'?'Reprise reservee aux lots definitivement rejetes':c==='P2002'?'Reprise deja approuvee pour ce lot':'Autorisation de reprise impossible',c==='SELF_APPROVAL'?403:409)}
}
