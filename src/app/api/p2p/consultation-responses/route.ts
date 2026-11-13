import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {accessGate,currentActor,hasPermission} from '@/lib/access-gate';
import {db} from '@/lib/db';
import {serializedSQLiteWrite} from '@/lib/sqlite-write';
const S=z.object({rfqId:z.number().int().positive(),supplierId:z.number().int().positive(),action:z.enum(['contacted','reminded','declined']),reason:z.string().trim().min(10).max(500).optional()});
export async function POST(req:NextRequest){
 const denied=accessGate(req,'buyer');if(denied)return denied;
 if(!hasPermission(req,'purchases.create'))return NextResponse.json({error:'Permission insuffisante'},{status:403});
 const p=S.safeParse(await req.json().catch(()=>null));if(!p.success)return NextResponse.json({error:'Action invalide'},{status:400});
 const d=p.data,actor=currentActor(req)!;
 if(d.action==='declined'&&!d.reason)return NextResponse.json({error:'Motif de refus obligatoire'},{status:400});
 try{
  const result=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   const line=await tx.supplierConsultationRecipientLine.findFirst({where:{rfqId:d.rfqId,recipient:{supplierId:d.supplierId}},include:{rfq:{select:{status:true,offers:{where:{supplierId:d.supplierId},select:{id:true}}}}}});
   if(!line||line.rfq.status!=='open'||line.rfq.offers.length)throw Error('INVITATION_NON_MODIFIABLE');
   if(line.responseStatus==='declined')throw Error('REFUS_DEJA_CONSIGNE');
   const update=d.action==='declined'?{responseStatus:'declined',declineReason:d.reason}:d.action==='contacted'?{responseStatus:'contacted',contactAt:new Date()}:{responseStatus:'contacted',lastReminderAt:new Date(),reminderCount:{increment:1}};
   await tx.supplierConsultationRecipientLine.update({where:{id:line.id},data:update});
   await tx.auditEvent.create({data:{actor:actor.username,action:`SUPPLIER_${d.action.toUpperCase()}`,entity:'SupplierConsultationRecipientLine',entityId:String(line.id),details:JSON.stringify({rfqId:d.rfqId,supplierId:d.supplierId,reason:d.reason??null})}});
   return {rfqId:d.rfqId,supplierId:d.supplierId,status:d.action};
  }));return NextResponse.json({result},{status:201});
 }catch{return NextResponse.json({error:'Action refusée ou consultation clôturée'},{status:409});}
}
