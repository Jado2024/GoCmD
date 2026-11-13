import { safeErrorMetadata } from "@/lib/safe-server-error"
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { accessGate, readRoleGate, currentActor, hasPermission, canSeeMaterialCosts } from '@/lib/access-gate';
import { db } from '@/lib/db';
import { serializedSQLiteWrite } from '@/lib/sqlite-write';
import { isValidPurchaseQuantity } from '@/lib/purchase-quantity';
import { remainingToOrder } from '@/lib/purchase-availability';
import {contractEligibleForAward} from '@/lib/supplier-award-rules';
import {validPriceSourceConversion} from '@/lib/supplier-source-unit';

import { consultationRisk } from '@/lib/consultation-priority';
import type { ConsultationSummary } from '@/lib/consultation-summary';
import { consultationListQuery } from '@/lib/consultation-list-query';

export const dynamic='force-dynamic';
const Input = z.object({
 lines:z.array(z.object({requestLineId:z.number().int().positive(),qty:z.number().finite().positive().max(1_000_000),supplierIds:z.array(z.number().int().positive()).min(1).max(20).optional()})).min(1).max(50),
 supplierIds:z.array(z.number().int().positive()).min(1).max(20),
 deadline:z.iso.date().optional(),
 reconsultReason:z.string().trim().min(10).max(500).optional(),
});
export async function GET(req:NextRequest){
 const denied=readRoleGate(req,['buyer','approver','finance']);if(denied)return denied;
 const actor=currentActor(req)!;
 const costVisible=canSeeMaterialCosts(req);
 const params=req.nextUrl.searchParams;
 // Une permission de lecture sans accès tarifaire n'autorise pas à déduire
 // quels fournisseurs sont liés par un prix contractuel.
 if(!costVisible&&['contract','no_contract'].includes(params.get('contractStatus')??''))
  return NextResponse.json({error:'Filtre contractuel réservé aux achats habilités'},{status:403});
 const page=Math.max(1,Math.min(1_000_000,Math.trunc(Number(params.get('page')??1)||1)));
 const pageSize=Math.max(1,Math.min(100,Math.trunc(Number(params.get('pageSize')??40)||40)));
 const from=params.get('from') || undefined;
 const to=params.get('to') || undefined;
 if ((from && !z.iso.date().safeParse(from).success) || (to && !z.iso.date().safeParse(to).success) || (from && to && from>to))
  return NextResponse.json({error:'Période de consultation invalide'},{status:400});
 const id=Number(params.get('id')??0);
 if(params.has('id') && (!Number.isSafeInteger(id) || id<=0))
  return NextResponse.json({error:'Identifiant de consultation invalide'},{status:400});
 const search=(params.get('search')??'').trim().slice(0,100);
 const exact=!id&&search?await db.supplierConsultation.findUnique({where:{ref:search.toUpperCase()},select:{id:true}}):null;
 const {where,order:sortSql}=consultationListQuery({
  search:exact?'':search,
  category:(params.get('category')??'').trim().slice(0,80),
  supplierId:Number(params.get('supplierId')??0),
  priority:params.get('priority')??'all',status:params.get('status')??'all',
  contractStatus:params.get('contractStatus')??'all',
  sort:params.get('sort')??'urgency',from,to,id:id||exact?.id,
 },Date.now()+3*86400000);
 const [counts, pageRows]=await db.$transaction([
  db.$queryRaw<{total:bigint}[]>(Prisma.sql`SELECT count(*) AS total FROM SupplierConsultation c ${where}`),
  db.$queryRaw<{id:number}[]>(Prisma.sql`SELECT c.id FROM SupplierConsultation c ${where}
   ORDER BY ${sortSql} LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`),
 ]);
 const total=Number(counts[0].total);
 const ids=pageRows.map(r=>r.id);
 const pagination={page,pageSize,total,hasMore:page*pageSize<total};
 const headers={'Cache-Control':'private, no-store'};
 if(params.get('view')==='summary'){
  const summaries=await db.supplierConsultation.findMany({where:{id:{in:ids}},select:{
   id:true,ref:true,createdAt:true,deadline:true,_count:{select:{recipients:true}},
   lines:{select:{rfq:{select:{
    requestLineId:true,status:true,targetDate:true,
    material:{select:{name:true,stockQty:true,minStock:true}},
    _count:{select:{offers:true}},
    offers:{where:{responseChannel:'phone',confirmationStatus:'pending'},select:{id:true},take:1},
    awardPlans:{where:{status:'pending'},select:{id:true},take:1},
   }}}},
  }});
  const requestLineIds=summaries.flatMap(row=>row.lines.flatMap(({rfq})=>rfq.requestLineId?[rfq.requestLineId]:[]));
  const daRows=await db.purchaseRequestLine.findMany({
   where:{id:{in:[...new Set(requestLineIds)]}},
   select:{id:true,request:{select:{ref:true}}},
  });
  const daRefs=new Map(daRows.map(line=>[line.id,line.request.ref]));
  const byId=new Map(summaries.map(row=>[row.id,row]));
  const items:ConsultationSummary[]=ids.flatMap(id=>{
   const row=byId.get(id);
   if(!row)return [];
   const lines=row.lines.map(l=>l.rfq);
   const offerCount=lines.reduce((sum,l)=>sum+l._count.offers,0);
   const status=lines.length&&lines.every(l=>l.status==='awarded')?'awarded':
    lines.length&&lines.every(l=>l.status==='closed'||l.status==='awarded')?'closed':
    lines.some(l=>l.status==='open'&&l.awardPlans.length)?'pending_decision':
    lines.some(l=>l.status==='open'&&l.offers.length)?'pending_validation':
    offerCount?'in_progress':'prepared';
   const deadline=row.deadline?.toISOString()??null;
   return [{id:row.id,ref:row.ref,createdAt:row.createdAt.toISOString(),deadline,status,offerCount,
    supplierCount:row._count.recipients,
    materials:[...new Set(lines.map(l=>l.material.name))],
    requestRefs:[...new Set(lines.flatMap(l=>{const ref=l.requestLineId?daRefs.get(l.requestLineId):undefined;return ref?[ref]:[]}))],
    risk:consultationRisk(lines.map(l=>({material:l.material,targetDate:l.targetDate?.toISOString()})),deadline),
   }];
  });
  return NextResponse.json({items,pagination},{headers});
 }
 const rows=ids.length?await db.supplierConsultation.findMany({
  where:{id:{in:ids}},
  include:{
   lines:{include:{rfq:{include:{
    material:{select:{ref:true,name:true,category:true,unit:true,stockQty:true,minStock:true}},
    offers:{include:{supplier:{select:{name:true}},attachments:{select:{id:true,originalName:true,bytes:true,revisionNo:true}}}},
    awardPlans:{include:{lines:{include:{offer:{select:{supplierId:true}}}},contractLines:{include:{agreement:{select:{supplierId:true,contractRef:true}}}}},orderBy:{proposedAt:'desc'}}
   }}}},
   recipients:{include:{
    supplier:{select:{id:true,name:true,email:true,phone:true,active:true}},
    lines:{include:{rfq:{select:{materialId:true,offers:{select:{supplierId:true}}}}}}
   }}
  }
 }):[];
 // Un prix contractuel est une source d'achat existante, PAS une offre fictive.
 // Le filtre en consultation doit voir le contrat en même temps que les devis reçus.
 const materialIds=[...new Set(rows.flatMap(row=>row.lines.map(l=>l.rfq.materialId)))];
 const agreements=costVisible&&materialIds.length?await db.supplierPriceAgreement.findMany({
  where:{materialId:{in:materialIds},status:'approved',validFrom:{lte:new Date()},validUntil:{gte:new Date()},currency:'MAD',supplier:{is:{active:true}}},
  include:{supplier:{select:{name:true,active:true,materials:{where:{materialId:{in:materialIds}},select:{materialId:true,purchaseUnit:true,unitsPerPurchase:true,leadTimeDays:true}},qualifications:{orderBy:[{reviewedAt:'desc'},{id:'desc'}],take:1,select:{status:true,expiresAt:true}}}}}
 }):[];
 const qualifiedContracts=agreements.filter(a=>{
  const association=a.supplier.materials.find(m=>m.materialId===a.materialId);
  const latest=a.supplier.qualifications[0];
  return contractEligibleForAward(a)&&!!a.documentRef?.trim()&&!!association&&!!latest&&latest.status==='approved'&&(!latest.expiresAt||latest.expiresAt>=new Date())&&validPriceSourceConversion({priceBasis:a.priceBasis,priceBasisFactor:a.priceBasisFactor,sourceUnitPrice:a.sourceUnitPrice===null?null:Number(a.sourceUnitPrice),unitPrice:Number(a.unitPrice)},association.unitsPerPurchase);
 });
 const contractsByMaterial=new Map<number,typeof qualifiedContracts>();
 for(const a of qualifiedContracts)contractsByMaterial.set(a.materialId,[...(contractsByMaterial.get(a.materialId)??[]),a]);
 const order=new Map(ids.map((id,index)=>[id,index]));rows.sort((a,b)=>(order.get(a.id)??0)-(order.get(b.id)??0));
 const derivedStatus=(row:typeof rows[number])=>row.lines.every(l=>l.rfq.status==='awarded')?'awarded':
 row.lines.every(l=>['closed','awarded'].includes(l.rfq.status))?'closed':
 row.lines.some(l=>l.rfq.awardPlans.some(p=>p.status==='pending'))?'pending_decision':
 row.lines.some(l=>l.rfq.offers.length>0)?'in_progress':'prepared';
 const items=rows.map(row=>({id:row.id,ref:row.ref,status:derivedStatus(row),createdAt:row.createdAt.toISOString(),createdBy:row.createdBy,
  deadline:row.deadline?.toISOString()??null,
  lines:row.lines.map(line=>({rfqId:line.rfq.id,requestLineId:line.rfq.requestLineId,ref:line.rfq.ref,
   materialId:line.rfq.materialId,material:line.rfq.material,qty:line.rfq.qty,unit:line.rfq.unit,status:line.rfq.status,
   targetDate:line.rfq.targetDate?.toISOString()??null,
   awardPlans:line.rfq.awardPlans.map(plan=>({id:plan.id,status:plan.status,proposedBy:plan.proposedBy,proposedAt:plan.proposedAt.toISOString(),decidedBy:plan.decidedBy,reason:costVisible?plan.reason:null,decisionNote:costVisible?plan.decisionNote:null,lines:[...plan.lines.map(a=>({sourceType:'QUOTE' as const,sourceId:a.offerId,offerId:a.offerId,supplierId:a.offer.supplierId,qty:a.qty,unitPrice:costVisible?String(a.unitPrice):null,ref:null})),...plan.contractLines.map(a=>({sourceType:'CONTRACT' as const,sourceId:a.agreementId,offerId:null,supplierId:a.agreement.supplierId,qty:a.qty,unitPrice:costVisible?String(a.unitPrice):null,ref:costVisible?a.agreement.contractRef:null}))]})),
   contracts:costVisible?(contractsByMaterial.get(line.rfq.materialId)??[]).map(a=>({
    id:a.id,supplierId:a.supplierId,supplierName:a.supplier.name,contractRef:a.contractRef,
    documentRef:a.documentRef,unitPrice:String(a.unitPrice),validFrom:a.validFrom.toISOString(),validUntil:a.validUntil.toISOString(),
    leadTimeDays:a.supplier.materials.find(m=>m.materialId===a.materialId)?.leadTimeDays??null,
    purchaseUnit:a.supplier.materials.find(m=>m.materialId===a.materialId)?.purchaseUnit??null,
    paymentTerms:null,status:'approved'
   })):[],
   offers:line.rfq.offers.map(o=>({id:o.id,supplierId:o.supplierId,supplierName:o.supplier.name,quoteRef:o.quoteRef,
    validUntil:o.validUntil?.toISOString()??null,paymentTerms:costVisible?o.paymentTerms:null,unitPrice:costVisible?String(o.unitPrice):null,qty:o.qty,leadTimeDays:o.leadTimeDays,chosen:o.chosen,confirmationStatus:o.confirmationStatus,responseChannel:o.responseChannel,contactName:costVisible?o.contactName:null,callSummary:costVisible?o.callSummary:null,respondedAt:o.respondedAt?.toISOString()??null,hasEmailEvidence:o.responseChannel==="email"&&!!o.documentRef?.trim(),hasAttachment:o.attachments.some(a=>a.revisionNo===o.revisionNo),attachments:costVisible?o.attachments.filter(a=>a.revisionNo===o.revisionNo):[],
    buyerValidatedBy:costVisible?o.buyerValidatedBy:null,buyerValidatedAt:costVisible?o.buyerValidatedAt?.toISOString()??null:null,
    approvedBy:costVisible?o.approvedBy:null,approvedAt:costVisible?o.approvedAt?.toISOString()??null:null}))})),
  recipients:row.recipients.map(r=>({supplierId:r.supplierId,name:r.supplier.name,active:r.supplier.active,
   email:actor.roles.includes('buyer')||actor.roles.includes('admin')?r.supplier.email:null,
   phone:actor.roles.includes('buyer')||actor.roles.includes('admin')?r.supplier.phone:null,
   materialIds:r.lines.map(l=>l.rfq.materialId),responses:r.lines.map(l=>({rfqId:l.rfqId,status:l.rfq.offers.some(o=>o.supplierId===r.supplierId)?'responded':l.responseStatus,reminderCount:l.reminderCount,lastReminderAt:l.lastReminderAt?.toISOString()??null,declineReason:l.declineReason}))})),
 }));
 return NextResponse.json({items,costVisible,pagination},{headers});
}
export async function POST(req:NextRequest){
 const denied=accessGate(req,'buyer');if(denied)return denied;
 if(!hasPermission(req,'purchases.create'))return NextResponse.json({error:'Autorisation de consultation refusée'},{status:403});
 const actor=currentActor(req)!;
 const parsed=Input.safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Consultation invalide',details:parsed.error.flatten()},{status:400});
 const d=parsed.data;
 if(new Set(d.lines.map(l=>l.requestLineId)).size!==d.lines.length||new Set(d.supplierIds).size!==d.supplierIds.length)
  return NextResponse.json({error:'Ligne ou fournisseur présent deux fois'},{status:400});
 if(d.deadline&&new Date(`${d.deadline}T23:59:59Z`)<new Date())return NextResponse.json({error:'La date limite ne peut pas être passée'},{status:400});
 try{
  const result=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   const requestLines=await tx.purchaseRequestLine.findMany({where:{id:{in:d.lines.map(x=>x.requestLineId)}},
    include:{request:true,material:true,supplierOrderLines:{include:{order:true}}}});
   if(requestLines.length!==d.lines.length||requestLines.some(l=>!['approved','partially_approved','ordered','partial'].includes(l.request.status)))throw Error('DA_NON_VALIDEE');
   const openRfqs=await tx.supplierRFQ.findMany({where:{requestLineId:{in:d.lines.map(l=>l.requestLineId)},status:'open'},select:{ref:true,requestLineId:true,qty:true}})
   if(openRfqs.length&&!d.reconsultReason)throw Object.assign(new Error('RFQ_DEJA_OUVERTE'),{openRfqs})
   const suppliers=await tx.supplier.findMany({where:{id:{in:d.supplierIds},active:true},include:{materials:true}});
   if(suppliers.length!==d.supplierIds.length)throw Error('FOURNISSEUR_INACTIF');
   const recipientsByLine=new Map<number,number[]>();
   for(const line of d.lines){
    const row=requestLines.find(l=>l.id===line.requestLineId)!;
    if(!isValidPurchaseQuantity(line.qty,row.material.unit))throw Error('QTE_UNITE_INVALIDE');
    const remaining=remainingToOrder(row);
    if(line.qty>remaining+0.000001)throw Error('QTE_SUPERIEURE_RESTE');
    const compatible=suppliers.filter(s=>s.materials.some(l=>l.materialId===row.materialId)).map(s=>s.id);
    const recipients=line.supplierIds??compatible;
    if(!recipients.length)throw Error('AUCUN_FOURNISSEUR_LIGNE');
    if(new Set(recipients).size!==recipients.length||recipients.some(id=>!compatible.includes(id)))throw Error('DESTINATAIRE_LIGNE_INVALIDE');
    recipientsByLine.set(line.requestLineId,recipients);
   }
   if(suppliers.some(s=>![...recipientsByLine.values()].some(ids=>ids.includes(s.id))))throw Error('FOURNISSEUR_SANS_LIGNE');
   const ref=`CONS-${new Date().getUTCFullYear()}-${randomUUID().slice(0,10).toUpperCase()}`;
   const consultation=await tx.supplierConsultation.create({data:{ref,createdBy:actor.username,
    deadline:d.deadline?new Date(`${d.deadline}T23:59:59Z`):null}});
   const rfqIds=new Map<number,number>();
   for(const line of d.lines){
    const row=requestLines.find(l=>l.id===line.requestLineId)!;
    const rfq=await tx.supplierRFQ.create({data:{ref:`RFQ-${new Date().getUTCFullYear()}-${randomUUID().slice(0,12).toUpperCase()}`,
     materialId:row.materialId,requestLineId:row.id,qty:line.qty,unit:row.material.unit,
     deadline:d.deadline?new Date(`${d.deadline}T23:59:59Z`):null,targetDate:row.request.expectedDate,createdBy:actor.username}});
    await tx.supplierConsultationLine.create({data:{consultationId:consultation.id,rfqId:rfq.id}});
    rfqIds.set(row.id,rfq.id);
   }
   for(const supplier of suppliers){
    const recipient=await tx.supplierConsultationRecipient.create({data:{consultationId:consultation.id,supplierId:supplier.id}});
    for(const line of d.lines){
     if(recipientsByLine.get(line.requestLineId)?.includes(supplier.id)){
      await tx.supplierConsultationRecipientLine.create({data:{recipientId:recipient.id,rfqId:rfqIds.get(line.requestLineId)!}});
     }
    }
   }
   await tx.auditEvent.create({data:{actor:actor.username,action:'CONSULTATION_PREPARED',entity:'SupplierConsultation',entityId:String(consultation.id),
    details:JSON.stringify({ref,requestLineIds:d.lines.map(l=>l.requestLineId),supplierIds:d.supplierIds,recipientsByLine:Object.fromEntries(recipientsByLine),mailSent:false,reconsultReason:d.reconsultReason??null,priorRfqs:openRfqs.map(r=>r.ref)})}});
   return {id:consultation.id,ref};
  }));
  return NextResponse.json({consultation:result,mailSent:false},{status:201});
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const errors:Record<string,string>={DA_NON_VALIDEE:'Une ligne appartient à une DA non validée',FOURNISSEUR_INACTIF:'Fournisseur inexistant ou suspendu',
   QTE_SUPERIEURE_RESTE:'Quantité supérieure au besoin disponible à commander',AUCUN_FOURNISSEUR_LIGNE:'Aucun fournisseur sélectionné pour une matière',
   DESTINATAIRE_LIGNE_INVALIDE:'Fournisseur non référencé ou présent deux fois sur une ligne',
   QTE_UNITE_INVALIDE:'Quantité incompatible avec l’unité de stock',FOURNISSEUR_SANS_LIGNE:'Un fournisseur sélectionné ne référence aucune des matières'};
  if(code==='RFQ_DEJA_OUVERTE')return NextResponse.json({error:'Une consultation existe déjà pour ce besoin',code,openRfqs:(e as Error&{openRfqs:unknown[]}).openRfqs},{status:409});
  if(errors[code])return NextResponse.json({error:errors[code]},{status:409});
  console.error('Consultation P5.12 refusée',safeErrorMetadata(e));
  return NextResponse.json({error:'Consultation non créée : vérifiez les données ou réessayez'},{status:409});
 }
}
