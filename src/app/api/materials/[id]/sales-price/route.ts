import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {accessGate,currentActor,hasRole,hasPermission,isDirector} from '@/lib/access-gate'
import {db} from '@/lib/db'
import {serializedSQLiteWrite} from '@/lib/sqlite-write'
const S=z.discriminatedUnion('action',[
 z.object({action:z.literal('propose'),price:z.number().finite().min(0).max(1e8).refine(x=>Math.abs(x*100-Math.round(x*100))<1e-6),reason:z.string().trim().min(10).max(500)}).strict(),
 z.object({action:z.enum(['approve','reject']),revision:z.number().int().nonnegative(),reason:z.string().trim().min(10).max(500)}).strict(),
])
export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}){
 const denied=accessGate(req);if(denied)return denied
 const id=Number((await ctx.params).id)
 if(!Number.isSafeInteger(id)||id<=0)return NextResponse.json({error:'Matière invalide'},{status:400})
 const parsed=S.safeParse(await req.json().catch(()=>null))
 if(!parsed.success)return NextResponse.json({error:'Proposition invalide'},{status:400})
 const d=parsed.data,actor=currentActor(req)!.username
 if(d.action==='propose'&&(!hasRole(req,'buyer')||(currentActor(req)?.managed&&!hasPermission(req,'materials.manage'))))return NextResponse.json({error:'Responsable achats requis'},{status:403})
 // C4-02 (contre-audit CASCADE4) : visa directeur = rôle ET permission director.prices (révocable), comme les autres circuits tarifaires.
 if(d.action!=='propose'&&(!isDirector(req)||(currentActor(req)?.managed&&!hasPermission(req,'director.prices'))))return NextResponse.json({error:'Visa directeur obligatoire'},{status:403})
 try{
  const m=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   await tx.salesDocCounter.upsert({where:{id:'GOCMD_MATERIAL_SALES_PRICE_LOCK'},create:{id:'GOCMD_MATERIAL_SALES_PRICE_LOCK',value:1},update:{value:{increment:1}}})
   const prev=await tx.material.findUnique({where:{id}})
   if(!prev||!prev.isSellable)throw Error('NOT_SELLABLE')
   if(d.action==='propose'){
    if(prev.pendingSalesUnitPrice!==null)throw Error('ALREADY_PENDING')
    if(Math.abs(prev.salesUnitPrice-d.price)<0.005)throw Error('SAME_PRICE')
    const m=await tx.material.update({where:{id},data:{pendingSalesUnitPrice:d.price,salesPriceProposedBy:actor,salesPriceProposalReason:d.reason,salesPriceProposedAt:new Date(),salesPriceProposalRevision:{increment:1}}})
    await tx.auditEvent.create({data:{actor,action:'MATERIAL_SALES_PRICE_PROPOSED',entity:'Material',entityId:String(id),details:JSON.stringify({from:prev.salesUnitPrice,to:d.price,reason:d.reason,revision:m.salesPriceProposalRevision})}})
    return m
   }
   if(prev.pendingSalesUnitPrice===null||prev.salesPriceProposalRevision!==d.revision)throw Error('STALE_PRICE_PROPOSAL')
   if(prev.salesPriceProposedBy===actor)throw Error('SELF_APPROVAL')
   const price=d.action==='approve'?prev.pendingSalesUnitPrice:prev.salesUnitPrice
   const m=await tx.material.update({where:{id},data:{salesUnitPrice:price,pendingSalesUnitPrice:null,salesPriceProposedBy:null,salesPriceProposalReason:null,salesPriceProposedAt:null}})
   if(d.action==='approve')await tx.product.updateMany({where:{materialId:id},data:{unitPrice:price}})
   await tx.auditEvent.create({data:{actor,action:d.action==='approve'?'MATERIAL_SALES_PRICE_APPROVED':'MATERIAL_SALES_PRICE_REJECTED',entity:'Material',entityId:String(id),details:JSON.stringify({old:prev.salesUnitPrice,proposal:prev.pendingSalesUnitPrice,after:price,proposedBy:prev.salesPriceProposedBy,reason:d.reason})}})
   return m
  }))
  return NextResponse.json({id:m.id,salesUnitPrice:m.salesUnitPrice,pending:m.pendingSalesUnitPrice!==null,revision:m.salesPriceProposalRevision},{headers:{'Cache-Control':'no-store'}})
 }catch(e){const code=e instanceof Error?e.message:'';const messages:Record<string,string>={NOT_SELLABLE:'Matière non vendable',ALREADY_PENDING:'Proposition déjà en attente',SAME_PRICE:'Prix inchangé',STALE_PRICE_PROPOSAL:'Proposition déjà traitée ou modifiée',SELF_APPROVAL:'Auto-validation interdite'};return NextResponse.json({error:messages[code]??'Changement tarifaire refusé'},{status:409})}
}
