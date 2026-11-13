/** Changement du tarif de reference : proposition approbateur -> visa directeur.
 * Les prix des CMD confirmees restent figes dans OrderLine.
 */
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
 if(!Number.isSafeInteger(id)||id<=0)return NextResponse.json({error:'Produit invalide'},{status:400})
 const parsed=S.safeParse(await req.json().catch(()=>null))
 if(!parsed.success)return NextResponse.json({error:'Proposition ou decision invalide'},{status:400})
 const data=parsed.data,actor=currentActor(req)!.username
 if(data.action==='propose' && (!hasRole(req,'approver')||(currentActor(req)?.managed&&!hasPermission(req,'sales.approve'))))return NextResponse.json({error:'Proposition reservee au responsable'},{status:403})
 // C4-02 (contre-audit CASCADE4) : comme orders/[id] approve-prices et products/[id]/director-price,
 // le visa catalogue exige la PERMISSION director.prices (révocable individuellement), pas seulement le rôle.
 if(data.action!=='propose'&&(!isDirector(req)||(currentActor(req)?.managed&&!hasPermission(req,'director.prices'))))return NextResponse.json({error:'Visa directeur obligatoire'},{status:403})
 try {
  const product=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   await tx.salesDocCounter.upsert({where:{id:'GOCMD_CATALOG_PRICE_LOCK'},create:{id:'GOCMD_CATALOG_PRICE_LOCK',value:1},update:{value:{increment:1}}})
   const p=await tx.product.findUnique({where:{id}})
   if(!p||p.status!=='active'||p.materialId!==null||p.specialNotes)throw Error('NOT_ELIGIBLE')
   if(data.action==='propose'){
    if(p.pendingCatalogUnitPrice!==null)throw Error('ALREADY_PENDING')
    if(Math.abs(data.price-p.unitPrice)<0.005)throw Error('SAME_PRICE')
    const update=await tx.product.update({where:{id},data:{pendingCatalogUnitPrice:data.price,catalogPriceProposedBy:actor,catalogPriceProposalReason:data.reason,catalogPriceProposedAt:new Date(),catalogPriceProposalRevision:{increment:1}}})
    await tx.auditEvent.create({data:{actor,action:'CATALOG_PRICE_PROPOSED',entity:'Product',entityId:String(id),details:JSON.stringify({from:p.unitPrice,to:data.price,revision:update.catalogPriceProposalRevision,reason:data.reason})}})
    return update
   }
   if(p.pendingCatalogUnitPrice===null||p.catalogPriceProposalRevision!==data.revision)throw Error('STALE_PRICE_PROPOSAL')
   if(p.catalogPriceProposedBy===actor)throw Error('SELF_APPROVAL')
   const next=data.action==='approve'?p.pendingCatalogUnitPrice:p.unitPrice
   const update=await tx.product.update({where:{id},data:{unitPrice:next,pendingCatalogUnitPrice:null,catalogPriceProposedBy:null,catalogPriceProposalReason:null,catalogPriceProposedAt:null}})
   await tx.auditEvent.create({data:{actor,action:data.action==='approve'?'CATALOG_PRICE_APPROVED':'CATALOG_PRICE_REJECTED',entity:'Product',entityId:String(id),details:JSON.stringify({old:p.unitPrice,proposed:p.pendingCatalogUnitPrice,newPrice:next,revision:p.catalogPriceProposalRevision,reason:data.reason,proposedBy:p.catalogPriceProposedBy})}})
   return update
  }))
  return NextResponse.json({id:product.id,unitPrice:product.unitPrice,pending:product.pendingCatalogUnitPrice!==null,revision:product.catalogPriceProposalRevision},{headers:{'Cache-Control':'no-store'}})
 }catch(e){const code=e instanceof Error?e.message:'UNKNOWN';const msg:Record<string,string>={NOT_ELIGIBLE:'Prix gere par une autre fiche ou reference inactive',ALREADY_PENDING:'Une proposition tarifaire attend deja une decision',SAME_PRICE:'Prix identique au catalogue',STALE_PRICE_PROPOSAL:'Proposition invalide ou deja traitee',SELF_APPROVAL:'Le proposant ne peut pas valider sa proposition'};return NextResponse.json({error:msg[code]??'Decision impossible'},{status:409})}
}
