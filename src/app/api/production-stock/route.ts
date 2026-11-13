/** OF de fabrication pour stock (MTS) indépendants des OF de commandes clients. */
import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {db} from '@/lib/db'
import {accessGate,currentActor,hasRole,hasPermission} from '@/lib/access-gate'
import {serializedSQLiteWrite} from '@/lib/sqlite-write'
export const dynamic='force-dynamic'
const patch=z.object({orderId:z.number().int().positive(),action:z.enum(['plan','start','finish','cancel']),reason:z.string().trim().min(10).max(500),plannedStartAt:z.string().datetime().optional(),dueAt:z.string().datetime().optional()}).strict()
const RIGHTS:Record<string,string>={plan:'production.plan',start:'production.start',finish:'production.finish',cancel:'production.approve'}
function authorized(req:NextRequest,key:string){return hasRole(req,'production')&&(!currentActor(req)?.managed||hasPermission(req,key))}
function bad(message:string,status=409){return NextResponse.json({error:message},{status,headers:{'Cache-Control':'no-store'}})}
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 // R13 (SEC-R13-01, contre-audit B) : la lecture des OF de stock expose les
 // quantités et références matière ; un refus individuel de stock.read doit
 // être respecté aussi ici, comme sur /api/stock-lots et /api/movements.
 if(!authorized(req,'production.plan')&&!hasRole(req,'inventory')&&!hasRole(req,'quality'))return bad('Acces production refuse',403)
 const actor=currentActor(req)
 if(actor?.managed&&!hasPermission(req,'stock.read'))return bad('Lecture des lots réservée aux rôles habilités (stock.read)',403)
 const takeRaw=req.nextUrl.searchParams.get('take')??'50'
 const beforeRaw=req.nextUrl.searchParams.get('before')
 const n=Number(takeRaw),cursor=beforeRaw===null?null:Number(beforeRaw)
 // Un take fractionnaire provoquait une erreur Prisma 500 ; un curseur
 // invalide devait être signalé, et non ignoré en retournant la page 1.
 if(!Number.isSafeInteger(n)||n<1||n>100 || (cursor!==null&&(!Number.isSafeInteger(cursor)||cursor<1)))
  return bad('Pagination production invalide',400)
 const items=await db.productionStockOrder.findMany({where:cursor!==null?{id:{lt:cursor}}:{},include:{request:{select:{ref:true,productId:true,materialId:true,qty:true,unit:true,status:true}}},orderBy:{id:'desc'},take:n})
 return NextResponse.json({items,nextBefore:items.length===n?items.at(-1)?.id:null},{headers:{'Cache-Control':'private, no-store'}})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 const data=patch.safeParse(await req.json().catch(()=>null))
 if(!data.success)return bad('Action ou dates invalides',400)
 const d=data.data
 if(!authorized(req,RIGHTS[d.action]))return bad('Permission de production requise',403)
 if(d.action==='plan'){
   const start=d.plannedStartAt?new Date(d.plannedStartAt):new Date()
   const due=d.dueAt?new Date(d.dueAt):null
   if(due&&due.getTime()<start.getTime())return bad('Date de fin avant le debut de fabrication',400)
 }else if(d.plannedStartAt||d.dueAt)return bad('Dates autorisees pour la planification uniquement',400)
 const actor=currentActor(req)!.username
 try{
  const order=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   await tx.salesDocCounter.upsert({where:{id:'GOCMD_MTS_LOCK'},create:{id:'GOCMD_MTS_LOCK',value:1},update:{value:{increment:1}}})
   const wo=await tx.productionStockOrder.findUnique({where:{id:d.orderId},include:{request:true}})
   if(!wo||wo.request.status!=='approved')throw Error('INVALID')
   const from={plan:'approved',start:'planned',finish:'in_progress',cancel:'approved'}[d.action]
   if(wo.status!==from && !(d.action==='cancel'&&wo.status==='planned'))throw Error('INVALID')
   if(d.action==='cancel'){
    const receipts=wo.request.productId?await tx.finishedStockMovement.count({where:{type:'received_quarantine',lot:{sourceRef:wo.request.ref}}}):await tx.productionMaterialReceipt.count({where:{stockOrderId:wo.id}})
    if(receipts)throw Error('RECEIPT_ALREADY_EXISTS')
   }
   const now=new Date()
   const updated=await tx.productionStockOrder.update({where:{id:wo.id},data:d.action==='plan'?{
      status:'planned',plannedBy:actor,plannedStartAt:d.plannedStartAt?new Date(d.plannedStartAt):now,dueAt:d.dueAt?new Date(d.dueAt):null,statusReason:d.reason
    }:d.action==='start'?{status:'in_progress',startedBy:actor,startedAt:now,statusReason:d.reason}
    :d.action==='finish'?{status:'completed',completedBy:actor,completedAt:now,statusReason:d.reason}
    :{status:'cancelled',statusReason:d.reason}})
   if(d.action==='cancel')await tx.productionReplenishmentRequest.update({where:{id:wo.requestId},data:{status:'cancelled',decidedBy:actor,decidedAt:now,decisionReason:d.reason}})
   await tx.auditEvent.create({data:{actor,action:`MTS_OF_${d.action.toUpperCase()}`,entity:'ProductionStockOrder',entityId:String(wo.id),details:JSON.stringify({ref:wo.ref,from:wo.status,to:updated.status,reason:d.reason})}})
   return updated
  }))
  return NextResponse.json({order},{headers:{'Cache-Control':'no-store'}})
 }catch{return bad('Etat OF incompatible, reception deja existante ou conflit concurrent')}
}
