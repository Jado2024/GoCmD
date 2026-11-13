/** Finance-approved provisional MTS manufacturing cost, independent of quality and production.
 * This is a STANDARD manufacturing cost, never presented as actual BOM/MRP cost. */
import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {db} from '@/lib/db'
import {accessGate,currentActor,hasRole,hasPermission} from '@/lib/access-gate'
import {serializedSQLiteWrite} from '@/lib/sqlite-write'
export const dynamic='force-dynamic'
const approve=z.object({stockOrderId:z.number().int().positive(),unitCost:z.number().positive().finite().max(10000000),reason:z.string().trim().min(10).max(500)}).strict()
function allowed(req:NextRequest){return hasRole(req,'finance')&&(!currentActor(req)?.managed||hasPermission(req,'finance.purchases'))}
function bad(error:string,status=409){return NextResponse.json({error},{status,headers:{'Cache-Control':'no-store'}})}
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 if(!allowed(req))return bad('Habilitation finance obligatoire',403)
 const take=Math.min(100,Math.max(1,Number(req.nextUrl.searchParams.get('take'))||50))
 const before=Number(req.nextUrl.searchParams.get('before'))
 const orders=await db.productionStockOrder.findMany({where:{request:{materialId:{not:null},status:'approved'},...(Number.isSafeInteger(before)&&before>0?{id:{lt:before}}:{})},select:{id:true,ref:true,status:true,request:{select:{ref:true,qty:true,unit:true,createdBy:true,material:{select:{ref:true,name:true}}}},approvedMaterialCost:{select:{unitCost:true,currency:true,approvedBy:true,reason:true}}},orderBy:{id:'desc'},take})
 return NextResponse.json({items:orders.map(x=>({...x,approvedMaterialCost:x.approvedMaterialCost?{...x.approvedMaterialCost,unitCost:String(x.approvedMaterialCost.unitCost)}:null})),nextBefore:orders.length===take?orders.at(-1)?.id:null},{headers:{'Cache-Control':'private, no-store'}})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 if(!allowed(req))return bad('Habilitation finance obligatoire',403)
 const input=approve.safeParse(await req.json().catch(()=>null))
 if(!input.success)return bad('Cout standard positif en MAD et justification obligatoires',400)
 const actor=currentActor(req)!.username,d=input.data
 try{
  const result=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
    await tx.salesDocCounter.upsert({where:{id:'GOCMD_MTS_COST_LOCK'},create:{id:'GOCMD_MTS_COST_LOCK',value:1},update:{value:{increment:1}}})
    const wo=await tx.productionStockOrder.findUnique({where:{id:d.stockOrderId},include:{request:true}})
    if(!wo||!wo.request.materialId||wo.request.status!=='approved'||['closed','cancelled'].includes(wo.status))throw Error('WRONG_STATUS')
    if(wo.createdBy===actor||wo.request.createdBy===actor)throw Error('SELF_APPROVAL')
    const received=await tx.productionMaterialReceipt.count({where:{stockOrderId:wo.id,status:'released'}})
    if(received)throw Error('ALREADY_RELEASED')
    const cost=await tx.productionMaterialCostApproval.create({data:{stockOrderId:wo.id,unitCost:d.unitCost.toFixed(6),currency:'MAD',approvedBy:actor,reason:d.reason}})
    await tx.auditEvent.create({data:{actor,action:'MTS_MATERIAL_STANDARD_COST_APPROVED',entity:'ProductionStockOrder',entityId:String(wo.id),details:JSON.stringify({ref:wo.ref,unitCostMAD:d.unitCost.toFixed(6),policy:'STANDARD_PROVISIONAL',reason:d.reason})}})
    return cost
  }))
  return NextResponse.json({approved:{stockOrderId:result.stockOrderId,unitCost:String(result.unitCost),currency:'MAD',policy:'STANDARD_PROVISIONAL',approvedBy:actor}},{status:201,headers:{'Cache-Control':'no-store'}})
 }catch(e){const c=e instanceof Error?e.message:'UNKNOWN';return bad(c==='SELF_APPROVAL'?'Visa finance par un autre responsable obligatoire':c==='ALREADY_RELEASED'?'Cout fige apres liberation qualite':c==='WRONG_STATUS'?'OF non eligible':c==='P2002'?'Cout deja approuve et immuable':'Echec de validation du cout',c==='SELF_APPROVAL'?403:409)}
}
