import { safeErrorMetadata } from "@/lib/safe-server-error"
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {accessGate,currentActor,canSeeMaterialCosts,hasPermission} from '@/lib/access-gate';
import {db} from '@/lib/db';
import {serializedSQLiteWrite} from '@/lib/sqlite-write';
import {isAuthorizedSupplierQuote} from '@/lib/supplier-quote-authorization';
import {remainingToOrder} from '@/lib/purchase-availability';
import {nextRef} from '@/lib/erp-server';
import {isValidPurchaseQuantity} from '@/lib/purchase-quantity';
import {validPriceSourceConversion} from '@/lib/supplier-source-unit';
import {approvalIsIndependent,offerIsEligibleForAward,validateAwardQuantities,validateSourcingAllocations,contractEligibleForAward,AWARD_EPS,type SourcingAllocation} from '@/lib/supplier-award-rules';

export const dynamic='force-dynamic';
const positive=z.number().finite().positive().max(1_000_000);
// Legacy offerId retained so old screens/tests can submit existing quote plans.
const allocation=z.union([
 z.object({offerId:z.number().int().positive(),qty:positive}),
 z.object({sourceType:z.literal('QUOTE'),sourceId:z.number().int().positive(),qty:positive}),
 z.object({sourceType:z.literal('CONTRACT'),sourceId:z.number().int().positive(),qty:positive})
]);
const Input=z.discriminatedUnion('action',[
 z.object({action:z.literal('propose'),rfqId:z.number().int().positive(),reason:z.string().trim().min(20).max(2000),allocations:z.array(allocation).min(1).max(20)}),
 z.object({action:z.literal('defer'),rfqId:z.number().int().positive(),reason:z.string().trim().min(10).max(1000)}),
 z.object({action:z.literal('approve'),planId:z.number().int().positive(),decisionNote:z.string().trim().max(1000).optional()}),
 z.object({action:z.literal('reject'),planId:z.number().int().positive(),decisionNote:z.string().trim().min(10).max(1000)}),
 z.object({action:z.literal('createDraftOrders'),planId:z.number().int().positive()})
]);
const err=(code:string,status=409)=>NextResponse.json({error:code,code},{status});
const validDemandStates=new Set(['approved','partially_approved','ordered','partial']);
const normalise=(allocations:readonly z.infer<typeof allocation>[]):SourcingAllocation[]=>allocations.map(l=>('offerId'in l?{sourceType:'QUOTE',sourceId:l.offerId,qty:l.qty}:l));

/** A plan reserves its DA quantity until it is turned into approved BCs.
 * Confirmed BC quantities are already subtracted by remainingToOrder(). */
async function reservedByOtherPlans(tx:Prisma.TransactionClient,requestLineId:number,exceptId?:number){
 const plans=await tx.supplierAwardPlan.findMany({where:{rfq:{requestLineId},status:{in:['pending','approved']},...(exceptId?{id:{not:exceptId}}:{})},include:{lines:true,contractLines:true}});
 let total=0;
 for(const plan of plans){
  const allocated=[...plan.lines.map(l=>l.qty),...plan.contractLines.map(l=>l.qty)].reduce((n,x)=>n+x,0);
  const committed=plan.status==='approved'?await tx.supplierOrder.findMany({where:{note:{startsWith:`Attribution ${plan.id} / RFQ `},status:{in:['confirmed','partial','received']}},include:{lines:{where:{requestLineId}}}}):[];
  const counted=committed.flatMap(o=>o.lines).reduce((n,l)=>n+l.qty,0);
  total+=Math.max(0,allocated-counted);
 }
 return total;
}

async function sourceContext(tx:Prisma.TransactionClient,rfq:{id:number;materialId:number;unit:string;qty:number},sourceType:'QUOTE'|'CONTRACT',sourceId:number){
 if(sourceType==='QUOTE'){
  const offer=await tx.supplierQuoteOffer.findUnique({where:{id:sourceId},include:{attachments:{select:{id:true,revisionNo:true}}}});
  if(!offer||offer.rfqId!==rfq.id||offer.currency!=='MAD')return null;
  const accepted=offerIsEligibleForAward({...offer,attachments:offer.attachments.filter(a=>a.revisionNo===offer.revisionNo)});
  if(!accepted)return null;
  const supplierId=offer.supplierId;
  const [link,qual,supplier]=await Promise.all([
   tx.supplierMaterial.findUnique({where:{supplierId_materialId:{supplierId,materialId:rfq.materialId}}}),
   tx.supplierQualification.findFirst({where:{supplierId},orderBy:[{reviewedAt:'desc'},{id:'desc'}]}),
   tx.supplier.findUnique({where:{id:supplierId},select:{active:true}})
  ]);
  if(!supplier?.active||!link||!qual||qual.status!=='approved'||qual.expiresAt&&qual.expiresAt<new Date())return null;
  if(!validPriceSourceConversion({priceBasis:offer.priceBasis,priceBasisFactor:offer.priceBasisFactor,sourceUnitPrice:offer.sourceUnitPrice===null?null:Number(offer.sourceUnitPrice),unitPrice:Number(offer.unitPrice)},link.unitsPerPurchase))return null;
  return {sourceType,sourceId,supplierId,qty:offer.qty,unitPrice:Number(offer.unitPrice),ref:offer.quoteRef!,link,recordedBy:offer.recordedBy,buyerValidatedBy:offer.buyerValidatedBy};
 }
 const contract=await tx.supplierPriceAgreement.findUnique({where:{id:sourceId}});
 if(!contract||contract.currency!=='MAD'||contract.materialId!==rfq.materialId||!contractEligibleForAward(contract)||!contract.documentRef?.trim())return null;
 const supplierId=contract.supplierId;
 const [link,qual,supplier]=await Promise.all([
  tx.supplierMaterial.findUnique({where:{supplierId_materialId:{supplierId,materialId:rfq.materialId}}}),
  tx.supplierQualification.findFirst({where:{supplierId},orderBy:[{reviewedAt:'desc'},{id:'desc'}]}),
  tx.supplier.findUnique({where:{id:supplierId},select:{active:true}})
 ]);
 if(!supplier?.active||!link||!qual||qual.status!=='approved'||qual.expiresAt&&qual.expiresAt<new Date())return null;
 if(!validPriceSourceConversion({priceBasis:contract.priceBasis,priceBasisFactor:contract.priceBasisFactor,sourceUnitPrice:contract.sourceUnitPrice===null?null:Number(contract.sourceUnitPrice),unitPrice:Number(contract.unitPrice)},link.unitsPerPurchase))return null;
 return {sourceType,sourceId,supplierId,qty:rfq.qty,unitPrice:Number(contract.unitPrice),ref:contract.contractRef,link,recordedBy:contract.createdBy,buyerValidatedBy:null};
}

export async function POST(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied;
 if(!canSeeMaterialCosts(req))return err('Accès aux tarifs refusé',403);
 const parsed=Input.safeParse(await req.json().catch(()=>null));if(!parsed.success)return err('Entrée invalide',400);
 const d=parsed.data;
 const actor=currentActor(req)!;
 const supervisor=d.action==='approve'||d.action==='reject'||d.action==='defer';
 if(supervisor?!actor.roles.some(r=>r==='approver'):!actor.roles.some(r=>r==='buyer'))return err('Rôle non autorisé',403);
 if(actor.managed&&!hasPermission(req,supervisor?'supplier-orders.approve':'purchases.create'))return err('Permission manquante',403);
 try{
  const result=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   if(d.action==='defer'){
    const rfq=await tx.supplierRFQ.findUnique({where:{id:d.rfqId}});
    if(!rfq||rfq.status!=='open'||await tx.supplierAwardPlan.count({where:{rfqId:rfq.id,status:{in:['pending','approved']}}}))throw Error('RFQ_NON_REPORTABLE');
    if(rfq.createdBy===actor.username)throw Error('AUTO_DECISION');
    await tx.auditEvent.create({data:{actor:actor.username,action:'AWARD_DECISION_DEFERRED',entity:'SupplierRFQ',entityId:String(rfq.id),details:JSON.stringify({reason:d.reason,status:'open',outcome:'ATTENDRE_AUTRES_OFFRES'})}});
    return {rfqId:rfq.id,status:'open',decision:'wait',next:'Recevoir d’autres offres, aucun BC créé'};
   }
   if(d.action==='propose'){
    const rfq=await tx.supplierRFQ.findUnique({where:{id:d.rfqId}});
    if(!rfq||rfq.status!=='open'||!rfq.requestLineId)throw Error('RFQ_NON_ATTRIBUABLE');
    if(await tx.supplierAwardPlan.count({where:{rfqId:rfq.id,status:{in:['pending','approved']}}}))throw Error('PLAN_DEJA_PRESENT');
    const lines=normalise(d.allocations);
    const sources=await Promise.all(lines.map(l=>sourceContext(tx,rfq,l.sourceType,l.sourceId)));
    const maxima=new Map(sources.flatMap((s,i)=>s?[[`${lines[i].sourceType}:${lines[i].sourceId}`,s.qty] as const]:[]));
    // Compatibilité contrôlée avec le circuit P5.15.18 100 % devis.
    if(lines.every(l=>l.sourceType==='QUOTE')){
     const quoteIssue=validateAwardQuantities(rfq.qty,rfq.unit,lines.map(l=>({offerId:l.sourceId,qty:l.qty})),new Map(sources.filter(Boolean).map(s=>[s!.sourceId,s!.qty])));
     if(quoteIssue)throw Error(quoteIssue);
    }
    const problem=validateSourcingAllocations(rfq.qty,rfq.unit,lines,maxima);if(problem)throw Error(problem);
    const demand=await tx.purchaseRequestLine.findUnique({where:{id:rfq.requestLineId},include:{request:true,supplierOrderLines:{include:{order:true}}}});
    if(!demand||!validDemandStates.has(demand.request.status)||rfq.qty>remainingToOrder(demand)-await reservedByOtherPlans(tx,rfq.requestLineId)+AWARD_EPS)throw Error('DA_RELIQUAT_INSUFFISANT');
    const plan=await tx.supplierAwardPlan.create({data:{rfqId:rfq.id,reason:d.reason,proposedBy:actor.username,
     lines:{create:lines.filter(l=>l.sourceType==='QUOTE').map(l=>({offerId:l.sourceId,qty:l.qty,unitPrice:sources[lines.indexOf(l)]!.unitPrice}))},
     contractLines:{create:lines.filter(l=>l.sourceType==='CONTRACT').map(l=>({agreementId:l.sourceId,qty:l.qty,unitPrice:sources[lines.indexOf(l)]!.unitPrice}))}
    }});
    await tx.auditEvent.create({data:{actor:actor.username,action:'AWARD_PLAN_PROPOSED',entity:'SupplierAwardPlan',entityId:String(plan.id),details:JSON.stringify({reason:plan.reason,sources:lines.map((line,i)=>({...line,price:sources[i]!.unitPrice,ref:sources[i]!.ref}))})}});
    return {planId:plan.id,status:plan.status};
   }
   const plan=await tx.supplierAwardPlan.findUnique({where:{id:d.planId},include:{rfq:true,lines:{include:{offer:true}},contractLines:{include:{agreement:true}}}});
   if(!plan)throw Error('PLAN_ABSENT');
   if(d.action==='approve'||d.action==='reject'){
    if(plan.status!=='pending'||plan.rfq.status!=='open')throw Error('PLAN_NON_VALIDABLE');
    const offers=plan.lines.map(l=>l.offer);
    if(!approvalIsIndependent(plan.proposedBy,actor.username,plan.rfq.createdBy,offers))throw Error('AUTO_APPROBATION');
    if(d.action==='approve'){
     if(!plan.rfq.requestLineId)throw Error('DA_ABSENTE');
     const demand=await tx.purchaseRequestLine.findUnique({where:{id:plan.rfq.requestLineId},include:{request:true,supplierOrderLines:{include:{order:true}}}});
     if(!demand||!validDemandStates.has(demand.request.status)||plan.rfq.qty>remainingToOrder(demand)-await reservedByOtherPlans(tx,plan.rfq.requestLineId,plan.id)+AWARD_EPS)throw Error('DA_RELIQUAT_INSUFFISANT');
     const allocations:SourcingAllocation[]=[...plan.lines.map(l=>({sourceType:'QUOTE' as const,sourceId:l.offerId,qty:l.qty})),...plan.contractLines.map(l=>({sourceType:'CONTRACT' as const,sourceId:l.agreementId,qty:l.qty}))];
     const sources=await Promise.all(allocations.map(l=>sourceContext(tx,plan.rfq,l.sourceType,l.sourceId)));
     const maximums=new Map(sources.flatMap((s,i)=>s?[[`${allocations[i].sourceType}:${allocations[i].sourceId}`,s.qty] as const]:[]));
     if(!plan.contractLines.length){
     const quoteIssue=validateAwardQuantities(plan.rfq.qty,plan.rfq.unit,plan.lines.map(l=>({offerId:l.offerId,qty:l.qty})),new Map(sources.filter(Boolean).map(s=>[s!.sourceId,s!.qty])));
     if(quoteIssue)throw Error(quoteIssue);
    }
    const problem=validateSourcingAllocations(plan.rfq.qty,plan.rfq.unit,allocations,maximums);if(problem)throw Error(problem);
     for(const line of plan.lines){
      const source=sources[allocations.findIndex(a=>a.sourceType==='QUOTE'&&a.sourceId===line.offerId)];
      if(!source||Math.abs(source.unitPrice-Number(line.unitPrice))>0.0001)throw Error('OFFRE_MODIFIEE_OU_EXPIREE');
     }
     for(const line of plan.contractLines){
      const source=sources[allocations.findIndex(a=>a.sourceType==='CONTRACT'&&a.sourceId===line.agreementId)];
      if(!source||Math.abs(source.unitPrice-Number(line.unitPrice))>0.0001)throw Error('CONTRAT_MODIFIE_OU_EXPIRE');
     }
     for(const line of plan.lines)await tx.supplierQuoteOffer.update({where:{id:line.offerId},data:{chosen:true,approvedBy:actor.username,approvedAt:new Date()}});
     await tx.supplierRFQ.update({where:{id:plan.rfqId},data:{status:'awarded'}});
    }
    await tx.supplierAwardPlan.update({where:{id:plan.id},data:{status:d.action==='approve'?'approved':'rejected',decidedBy:actor.username,decidedAt:new Date(),decisionNote:d.decisionNote??null}});
    const linked=await tx.supplierConsultationLine.findUnique({where:{rfqId:plan.rfqId}});
    if(linked){
     const all=await tx.supplierConsultationLine.findMany({where:{consultationId:linked.consultationId},include:{rfq:{select:{status:true}}}});
     if(all.every(l=>l.rfq.status==='awarded'))await tx.supplierConsultation.update({where:{id:linked.consultationId},data:{status:'awarded'}});
    }
    await tx.auditEvent.create({data:{actor:actor.username,action:d.action==='approve'?'AWARD_PLAN_APPROVED':'AWARD_PLAN_REJECTED',entity:'SupplierAwardPlan',entityId:String(plan.id),details:JSON.stringify({quoteAllocations:plan.lines.map(l=>l.id),contractAllocations:plan.contractLines.map(l=>l.id),decisionNote:d.decisionNote??null})}});
    return {planId:plan.id,status:d.action==='approve'?'approved':'rejected',next:d.action==='approve'?'Créer les BC brouillons par fournisseur':null};
   }
   if(plan.status!=='approved'||plan.rfq.status!=='awarded'||!plan.rfq.requestLineId)throw Error('PLAN_NON_APPROUVE');
   if(plan.decidedBy===actor.username)throw Error('RESPONSABLE_NE_CREE_PAS_BC');
   const demand=await tx.purchaseRequestLine.findUnique({where:{id:plan.rfq.requestLineId},include:{request:true,supplierOrderLines:{include:{order:true}}}});
   if(!demand||!validDemandStates.has(demand.request.status)||plan.rfq.qty>remainingToOrder(demand)-await reservedByOtherPlans(tx,plan.rfq.requestLineId,plan.id)+AWARD_EPS)throw Error('DA_RELIQUAT_INSUFFISANT');
   if(await tx.supplierOrder.count({where:{note:{startsWith:`Attribution ${plan.id} / RFQ `}}}))throw Error('BC_DEJA_GENERE');
   const allocations:SourcingAllocation[]=[...plan.lines.map(l=>({sourceType:'QUOTE' as const,sourceId:l.offerId,qty:l.qty})),...plan.contractLines.map(l=>({sourceType:'CONTRACT' as const,sourceId:l.agreementId,qty:l.qty}))];
   const results:{id:number;ref:string;supplierId:number;qty:number}[]=[];
   for(const line of allocations){
    const source=await sourceContext(tx,plan.rfq,line.sourceType,line.sourceId);
    const captured=line.sourceType==='QUOTE'?plan.lines.find(l=>l.offerId===line.sourceId):plan.contractLines.find(l=>l.agreementId===line.sourceId);
    if(!source||!captured||Math.abs(source.unitPrice-Number(captured.unitPrice))>0.0001)throw Error('SOURCE_MODIFIEE_OU_EXPIREE');
    if(!isValidPurchaseQuantity(line.qty,plan.rfq.unit)||!(source.link.unitsPerPurchase>0))throw Error('QTE_UNITE_INVALIDE');
    const purchaseQty=line.qty/source.link.unitsPerPurchase;
    if(!isValidPurchaseQuantity(purchaseQty,source.link.purchaseUnit??plan.rfq.unit)||Math.abs(purchaseQty*source.link.unitsPerPurchase-line.qty)>AWARD_EPS)throw Error('QTE_UNITE_INVALIDE');
    if(line.sourceType==='QUOTE'){
     const offer=plan.lines.find(l=>l.offerId===line.sourceId)!.offer;
     const attachments=await tx.supplierOfferAttachment.findMany({where:{offerId:offer.id,revisionNo:offer.revisionNo},select:{id:true}});
     if(!offer.chosen||!offer.approvedBy||!isAuthorizedSupplierQuote({...offer,attachments}))throw Error('OFFRE_NON_AUTORISEE');
    }
    const ref=await nextRef('BC','supplierOrder',tx);
    const order=await tx.supplierOrder.create({data:{ref,supplierId:source.supplierId,status:'draft',createdBy:actor.username,
     note:`Attribution ${plan.id} / RFQ ${plan.rfq.ref} — ${line.sourceType} ${source.ref}`,
     lines:{create:{requestLineId:demand.id,materialId:plan.rfq.materialId,qty:line.qty,unitPrice:source.unitPrice,purchaseQty,purchaseUnit:source.link.purchaseUnit??plan.rfq.unit,conversionFactor:source.link.unitsPerPurchase,priceSourceType:line.sourceType,priceSourceId:line.sourceId,priceSourceRef:source.ref}}}});
    results.push({id:order.id,ref:order.ref,supplierId:source.supplierId,qty:line.qty});
   }
   await tx.auditEvent.create({data:{actor:actor.username,action:'AWARD_BC_DRAFTS_CREATED',entity:'SupplierAwardPlan',entityId:String(plan.id),details:JSON.stringify({orders:results,allocations})}});
   return {planId:plan.id,orders:results,next:'BC brouillons : approbation indépendante obligatoire'};
  }));
  return NextResponse.json({result},{status:201});
 }catch(e){
  const code=e instanceof Error?e.message:'ERREUR';
  const expected=new Set(['RFQ_NON_REPORTABLE','AUTO_DECISION','RFQ_NON_ATTRIBUABLE','PLAN_DEJA_PRESENT','QTE_ATTRIBUTION_INVALIDE','SOURCE_REPETEE','SOURCE_OU_QTE_INVALIDE','SOURCE_QTE_DEPASSEE','ATTRIBUTION_INCOMPLETE','DA_RELIQUAT_INSUFFISANT','PLAN_ABSENT','PLAN_NON_VALIDABLE','AUTO_APPROBATION','DA_ABSENTE','OFFRE_MODIFIEE_OU_EXPIREE','CONTRAT_MODIFIE_OU_EXPIRE','PLAN_NON_APPROUVE','RESPONSABLE_NE_CREE_PAS_BC','BC_DEJA_GENERE','SOURCE_MODIFIEE_OU_EXPIREE','OFFRE_NON_AUTORISEE','QTE_UNITE_INVALIDE']);
  if(!expected.has(code))console.error('award plan error',safeErrorMetadata(e));
  return err(expected.has(code)?code:'Opération refusée : vérifier la consultation et les droits');
 }
}
