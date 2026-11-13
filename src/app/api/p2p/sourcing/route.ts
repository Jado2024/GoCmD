import { safeErrorMetadata } from "@/lib/safe-server-error"
import { accessGate, currentActor, readRoleGate,hasPermission,canSeeMaterialCosts } from '@/lib/access-gate';
import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { serializedSQLiteWrite } from '@/lib/sqlite-write';
import { isValidPurchaseQuantity } from '@/lib/purchase-quantity';
import { remainingToOrder } from '@/lib/purchase-availability';
import { normaliseSupplierUnitPrice, validPriceSourceConversion } from '@/lib/supplier-source-unit';

const positive = z.number().finite().positive().max(1_000_000);
const S = z.discriminatedUnion('action', [
 z.object({action:z.literal('qualify'),supplierId:z.number().int().positive(),status:z.enum(['approved','suspended','rejected']),score:z.number().int().min(0).max(100),note:z.string().min(5).max(1000),expiresAt:z.iso.date().optional()}),
 z.object({action:z.literal('rfq'),materialId:z.number().int().positive(),requestLineId:z.number().int().positive().optional(),qty:positive,deadline:z.iso.date().optional(),targetDate:z.iso.date().optional()}),
 z.object({action:z.literal('offer'),evidenceChannel:z.enum(['written','email']).optional(),rfqId:z.number().int().positive(),supplierId:z.number().int().positive(),unitPrice:z.number().finite().positive(),priceBasis:z.enum(['STOCK','PURCHASE']).optional(),qty:positive,leadTimeDays:z.number().int().min(0).max(3650),paymentTerms:z.string().max(200).optional(),quoteRef:z.string().trim().min(2).max(100),validUntil:z.iso.date(),documentRef:z.string().trim().min(2).max(300).optional()}).refine(d=>d.evidenceChannel!=='email'||!!d.documentRef,{path:['documentRef'],message:'Référence du message fournisseur obligatoire'}),
 z.object({action:z.literal('oralOffer'),calledAt:z.iso.datetime({offset:true}).optional(),rfqId:z.number().int().positive(),supplierId:z.number().int().positive(),unitPrice:z.number().finite().positive(),priceBasis:z.enum(['STOCK','PURCHASE']).optional(),qty:positive,leadTimeDays:z.number().int().min(0).max(3650),contactName:z.string().trim().min(2).max(120),callSummary:z.string().trim().min(10).max(1000),paymentTerms:z.string().max(200).optional()}),
 z.object({action:z.literal('validatePhoneOffer'),offerId:z.number().int().positive(),validUntil:z.iso.date(),validationNote:z.string().trim().min(10).max(500)}),
 z.object({action:z.literal('confirmOffer'),offerId:z.number().int().positive(),quoteRef:z.string().trim().min(2).max(100),validUntil:z.iso.date(),documentRef:z.string().trim().min(2).max(300).optional()}),
 z.object({action:z.literal('agreement'),supplierId:z.number().int().positive(),materialId:z.number().int().positive(),contractRef:z.string().trim().min(2).max(100),documentRef:z.string().trim().min(2).max(300),unitPrice:z.number().finite().positive().max(1_000_000_000),priceBasis:z.enum(['STOCK','PURCHASE']).optional(),validFrom:z.iso.date(),validUntil:z.iso.date()}),
 z.object({action:z.literal('approveAgreement'),agreementId:z.number().int().positive()}),
 z.object({action:z.literal('revokeAgreement'),agreementId:z.number().int().positive(),reason:z.string().trim().min(10).max(500)}),
 z.object({action:z.literal('award'),rfqId:z.number().int().positive(),offerId:z.number().int().positive()}),
 z.object({action:z.literal('reviseOffer'),calledAt:z.iso.datetime({offset:true}).optional(),documentRef:z.string().trim().min(2).max(300).optional(),offerId:z.number().int().positive(),reason:z.string().trim().min(10).max(1000),unitPrice:z.number().finite().positive(),priceBasis:z.enum(['STOCK','PURCHASE']),qty:positive,leadTimeDays:z.number().int().min(0).max(3650),paymentTerms:z.string().max(200).optional(),quoteRef:z.string().trim().min(2).max(100).optional(),validUntil:z.iso.date().optional(),contactName:z.string().trim().min(2).max(120).optional(),callSummary:z.string().trim().min(10).max(1000).optional()}),
 z.object({action:z.literal('revision'),orderId:z.number().int().positive(),reason:z.string().min(10).max(500),lines:z.array(z.object({id:z.number().int().positive(),qty:positive,unitPrice:z.number().finite().min(0)})).min(1).max(200)}),
 z.object({action:z.literal('schedule'),orderId:z.number().int().positive(),targetDate:z.iso.date(),plannedQty:positive.optional(),note:z.string().max(500).optional()}),
 z.object({action:z.literal('closeRfq'),rfqId:z.number().int().positive()})
]);
function fail(code:string,status=409){return NextResponse.json({error:code},{status})}
export async function GET(req:NextRequest){
 const denied=readRoleGate(req,["buyer","approver","finance"]);if(denied)return denied;
 if(currentActor(req)?.legacy||!canSeeMaterialCosts(req))return NextResponse.json({error:"Consultations et tarifs réservés aux comptes habilités"},{status:403});
 const page=Math.max(1,Math.min(1_000_000,Math.trunc(Number(req.nextUrl.searchParams.get('page')??1)||1)));
 const pageSize=Math.max(1,Math.min(150,Math.trunc(Number(req.nextUrl.searchParams.get('pageSize')??150)||150)));
 const [total,rfqs,qualifications,revisions,schedules,agreements]=await Promise.all([
  db.supplierRFQ.count(),
  db.supplierRFQ.findMany({include:{material:{select:{name:true,unit:true}},offers:{include:{supplier:{select:{name:true}},attachments:{select:{id:true,originalName:true,bytes:true,uploadedAt:true,revisionNo:true}},revisions:{select:{id:true,version:true,reason:true,revisedBy:true,revisedAt:true},orderBy:{version:'desc'}}}}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize}),
  db.supplierQualification.findMany({orderBy:[{reviewedAt:'desc'},{id:'desc'}],take:300}),
  db.supplierOrderRevision.findMany({orderBy:{createdAt:'desc'},take:100}),
  db.supplierDeliverySchedule.findMany({orderBy:{targetDate:'asc'},take:150}),
  db.supplierPriceAgreement.findMany({include:{supplier:{select:{name:true}},material:{select:{name:true,unit:true}}},orderBy:{createdAt:'desc'},take:150})]);
 return NextResponse.json({pagination:{page,pageSize,total,hasMore:page*pageSize<total},rfqs:rfqs.map(r=>({...r,offers:r.offers.map(o=>({...o,unitPrice:String(o.unitPrice)}))})),qualifications,revisions,schedules,agreements:agreements.map(a=>({...a,unitPrice:String(a.unitPrice)}))});
}
export async function POST(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied;
 const actor=currentActor(req)!;
 const parsed=S.safeParse(await req.json().catch(()=>null));if(!parsed.success)return fail('Données invalides',400);
 const d=parsed.data;
 if(["offer","oralOffer","confirmOffer","validatePhoneOffer","agreement","approveAgreement","revokeAgreement","award","reviseOffer"].includes(d.action)&&!canSeeMaterialCosts(req))return fail("Accès aux tarifs non autorisé",403);
 if(actor.managed && !hasPermission(req,['qualify','revision','award','approveAgreement','revokeAgreement'].includes(d.action)?'supplier-orders.approve':'purchases.create'))return fail('Permission de sourcing refusée',403);
 // P5.15.21 RC (DEF-S-02) : le rôle admin pur est bloqué des API métier
 // (doctrine access-gate) ; les comptes mixtes agissent via leurs rôles
 // métier (approver/buyer), jamais via admin seul.
 const approver=actor.roles.includes('approver');
 const buyer=actor.roles.includes('buyer');
 if(['qualify','revision','award','approveAgreement','revokeAgreement'].includes(d.action)&&!approver)return fail('Approbateur requis',403);
 if(['rfq','offer','oralOffer','confirmOffer','validatePhoneOffer','schedule','closeRfq','agreement','reviseOffer'].includes(d.action)&&!buyer)return fail('Acheteur requis',403);
 try{
  const result=await serializedSQLiteWrite(() => db.$transaction(async tx=>{
   let entity='Sourcing',id='0',action=d.action, result:unknown;
   if(d.action==='qualify'){
    const supplier=await tx.supplier.findUnique({where:{id:d.supplierId}});
    if(!supplier)throw Error('FOURNISSEUR_INTROUVABLE');
    result=await tx.supplierQualification.create({data:{supplierId:d.supplierId,status:d.status,score:d.score,note:d.note,reviewedBy:actor.username,reviewedAt:new Date(),expiresAt:d.expiresAt?new Date(d.expiresAt):null}});
    entity='Supplier';id=String(d.supplierId);
   }else if(d.action==='rfq'){
    const material=await tx.material.findUnique({where:{id:d.materialId}});if(!material)throw Error('MATIERE_INTROUVABLE');
    if(!isValidPurchaseQuantity(d.qty,material.unit))throw Error('QTE_UNITE_INVALIDE');
    if(d.deadline&&new Date(d.deadline+'T23:59:59Z')<new Date())throw Error('DELAI_CONSULTATION_PASSE');
    if(d.requestLineId){
     const l=await tx.purchaseRequestLine.findUnique({where:{id:d.requestLineId},include:{request:true,supplierOrderLines:{include:{order:{select:{status:true}}}}}});
     if(!l||l.materialId!==d.materialId||!['approved','partially_approved','ordered','partial'].includes(l.request.status))throw Error('DA_NON_VALIDEE');
     // Le contrôle historique d.qty <= l.qty était insuffisant après BC et BR.
     // Même reliquat serveur que les consultations groupées et la liste des BC.
     if(d.qty>remainingToOrder(l)+0.000001)throw Error('RFQ_DEPASSE_RESTANT');
     const existing=await tx.supplierRFQ.findFirst({where:{requestLineId:d.requestLineId,status:'open'}});
     if(existing)throw Error('RFQ_DEJA_OUVERTE');
    }
    const ref=`RFQ-${new Date().getUTCFullYear()}-${randomUUID().slice(0,10).toUpperCase()}`;
    result=await tx.supplierRFQ.create({data:{ref,materialId:d.materialId,requestLineId:d.requestLineId??null,qty:d.qty,unit:material.unit,deadline:d.deadline?new Date(d.deadline+'T23:59:59Z'):null,targetDate:d.targetDate?new Date(d.targetDate+'T23:59:59Z'):null,createdBy:actor.username}});
    id=String((result as {id:number}).id);entity='SupplierRFQ';
   }else if(d.action==='offer'||d.action==='oralOffer'){
    const rfq=await tx.supplierRFQ.findUnique({where:{id:d.rfqId}});
    if(!rfq||rfq.status!=='open')throw Error('RFQ_FERMEE');
    // P5.12 : pour les dossiers groupés, seuls les fournisseurs effectivement
    // invités peuvent déposer une réponse sur cette RFQ. Les anciennes RFQ
    // unitaires restent compatibles avec le comportement P5.11.
    const groupLine=await tx.supplierConsultationLine.findUnique({where:{rfqId:d.rfqId}});
    if(groupLine){
     const invited=await tx.supplierConsultationRecipientLine.findFirst({where:{rfqId:d.rfqId,recipient:{consultationId:groupLine.consultationId,supplierId:d.supplierId}}});
     if(!invited)throw Error('FOURNISSEUR_NON_INVITE');
    }
    const link=await tx.supplierMaterial.findUnique({where:{supplierId_materialId:{supplierId:d.supplierId,materialId:rfq.materialId}}});
    if(!link)throw Error('FOURNISSEUR_NON_REFERENCE');
    if(!isValidPurchaseQuantity(d.qty,rfq.unit))throw Error('QTE_UNITE_INVALIDE');
    const pricing=normaliseSupplierUnitPrice(d.unitPrice,d.priceBasis,link.unitsPerPurchase);
    if(d.action==='offer'&&new Date(d.validUntil)<new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z'))throw Error('DEVIS_EXPIRE');
    if(d.qty>rfq.qty+0.000001)throw Error('QTE_DEVIS_EXCESSIVE');
    if(d.action==='oralOffer'&&d.calledAt&&Date.parse(d.calledAt)>Date.now())throw Error('APPEL_DATE_FUTURE');
    const supplier=await tx.supplier.findUnique({where:{id:d.supplierId}});if(!supplier?.active)throw Error('FOURNISSEUR_SUSPENDU');
    // Un seul dossier par fournisseur et RFQ. Le justificatif PDF est facultatif pour une offre orale,
    // qui devra recevoir la validation acheteur puis le visa distinct du responsable.
    const existingOffer=await tx.supplierQuoteOffer.findUnique({where:{rfqId_supplierId:{rfqId:d.rfqId,supplierId:d.supplierId}},select:{id:true}});
    if(existingOffer)throw Error('OFFRE_DEJA_EXISTANTE');
    result=await tx.supplierQuoteOffer.create({data:{rfqId:d.rfqId,supplierId:d.supplierId,unitPrice:pricing.stockUnitPrice.toFixed(4),priceBasis:pricing.basis,priceBasisFactor:pricing.conversionFactor,sourceUnitPrice:pricing.sourceUnitPrice.toFixed(4),qty:d.qty,currency:'MAD',leadTimeDays:d.leadTimeDays,paymentTerms:d.paymentTerms,quoteRef:d.action==='offer'?d.quoteRef:null,validUntil:d.action==='offer'?new Date(d.validUntil+'T23:59:59Z'):null,documentRef:d.action==='offer'?d.documentRef:null,responseChannel:d.action==='offer'?(d.evidenceChannel??'written'):'phone',confirmationStatus:d.action==='offer'?'confirmed':'pending',contactName:d.action==='oralOffer'?d.contactName:null,callSummary:d.action==='oralOffer'?d.callSummary:null,respondedAt:d.action==='oralOffer'&&d.calledAt?new Date(d.calledAt):new Date(),recordedBy:actor.username}});
    id=String((result as {id:number}).id);entity='SupplierQuoteOffer';
   }else if(d.action==='reviseOffer'){
    const old=await tx.supplierQuoteOffer.findUnique({where:{id:d.offerId},include:{rfq:true,attachments:true}});
    if(!old||old.rfq.status!=='open'||old.chosen)throw Error('OFFRE_NON_REVISABLE');
    if(await tx.supplierAwardPlan.count({where:{rfqId:old.rfqId,status:{in:['pending','approved']}}}))throw Error('PLAN_EN_ATTENTE');
    const link=await tx.supplierMaterial.findUnique({where:{supplierId_materialId:{supplierId:old.supplierId,materialId:old.rfq.materialId}}});
    if(!link||!isValidPurchaseQuantity(d.qty,old.rfq.unit)||d.qty>old.rfq.qty+0.000001)throw Error('QTE_UNITE_INVALIDE');
    const pricing=normaliseSupplierUnitPrice(d.unitPrice,d.priceBasis,link.unitsPerPurchase);
    if(old.responseChannel==='phone'&&(!d.contactName||!d.callSummary))throw Error('TRACE_APPEL_MANQUANTE');
    if(old.responseChannel!=='phone'&&(!d.quoteRef||!d.validUntil))throw Error('DATES_DEVIS_REQUISES');
    if(old.responseChannel==='phone'&&d.calledAt&&Date.parse(d.calledAt)>Date.now())throw Error('APPEL_DATE_FUTURE');
    if(old.responseChannel==='email'&&!d.documentRef)throw Error('REFERENCE_EMAIL_REQUISE');
    if(d.validUntil&&new Date(`${d.validUntil}T23:59:59Z`)<new Date())throw Error('DEVIS_EXPIRE');
    const snapshot={...old,attachments:old.attachments.map(a=>({id:a.id,sha256:a.sha256,revisionNo:a.revisionNo,originalName:a.originalName}))};
    await tx.supplierQuoteRevision.create({data:{offerId:old.id,version:old.revisionNo,previousSnapshot:JSON.stringify(snapshot),reason:d.reason,revisedBy:actor.username}});
    result=await tx.supplierQuoteOffer.update({where:{id:old.id},data:{unitPrice:pricing.stockUnitPrice.toFixed(4),sourceUnitPrice:pricing.sourceUnitPrice.toFixed(4),priceBasis:pricing.basis,priceBasisFactor:pricing.conversionFactor,qty:d.qty,leadTimeDays:d.leadTimeDays,paymentTerms:d.paymentTerms??null,quoteRef:old.responseChannel!=='phone'?d.quoteRef:null,validUntil:old.responseChannel!=='phone'?new Date(`${d.validUntil}T23:59:59Z`):null,documentRef:old.responseChannel==='email'?d.documentRef:null,contactName:old.responseChannel==='phone'?d.contactName:null,callSummary:old.responseChannel==='phone'?d.callSummary:null,respondedAt:old.responseChannel==='phone'&&d.calledAt?new Date(d.calledAt):new Date(),recordedBy:actor.username,revisionNo:{increment:1},confirmationStatus:old.responseChannel==='email'?'confirmed':'pending',buyerValidatedBy:null,buyerValidatedAt:null,approvedBy:null,approvedAt:null}});
    entity='SupplierQuoteOffer';id=String(old.id);
   }else if(d.action==='validatePhoneOffer'){
    const offer=await tx.supplierQuoteOffer.findUnique({where:{id:d.offerId},include:{rfq:true}});
    if(!offer||offer.responseChannel!=='phone'||offer.rfq.status!=='open'||offer.chosen||offer.confirmationStatus!=='pending')throw Error('OFFRE_NON_CONFIRMABLE');
    if(!offer.contactName?.trim()||!offer.callSummary?.trim()||!offer.respondedAt)throw Error('TRACE_APPEL_MANQUANTE');
    if(new Date(d.validUntil+'T23:59:59Z')<new Date())throw Error('DEVIS_EXPIRE');
    // TEL est une référence interne : elle ne prétend PAS être un devis signé du fournisseur.
    result=await tx.supplierQuoteOffer.update({where:{id:offer.id},data:{
     quoteRef:`TEL-${offer.id}`,validUntil:new Date(d.validUntil+'T23:59:59Z'),
     documentRef:`Compte rendu d'appel interne — offre #${offer.id}`,
     confirmationStatus:'confirmed',buyerValidatedBy:actor.username,buyerValidatedAt:new Date()
    }});
    entity='SupplierQuoteOffer';id=String(offer.id);
   }else if(d.action==='confirmOffer'){
    const offer=await tx.supplierQuoteOffer.findUnique({where:{id:d.offerId},include:{rfq:true,attachments:true}});
    if(!offer||offer.rfq.status!=='open'||offer.chosen||offer.confirmationStatus!=='pending')throw Error('OFFRE_NON_CONFIRMABLE');
    if(new Date(d.validUntil)<new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z'))throw Error('DEVIS_EXPIRE');
    // A free-text reference alone cannot certify an oral quote. Require a real attached PDF.
    if(!offer.attachments.some(a=>a.revisionNo===offer.revisionNo))throw Error('PDF_CONFIRMATION_REQUIS');
    result=await tx.supplierQuoteOffer.update({where:{id:d.offerId},data:{quoteRef:d.quoteRef,validUntil:new Date(d.validUntil+'T23:59:59Z'),documentRef:d.documentRef??`PDF #${offer.attachments.find(a=>a.revisionNo===offer.revisionNo)?.id}`,confirmationStatus:'confirmed',...(offer.responseChannel==='phone'?{buyerValidatedBy:actor.username,buyerValidatedAt:new Date()}:{})}});
    entity='SupplierQuoteOffer';id=String(d.offerId);
   }else if(d.action==='award'){
    throw Error('UTILISER_PLAN_ATTRIBUTION');
   }else if(d.action==='agreement'){
    if(d.validFrom>d.validUntil)throw Error('DATES_CONTRAT');
    const link=await tx.supplierMaterial.findUnique({where:{supplierId_materialId:{supplierId:d.supplierId,materialId:d.materialId}},include:{supplier:true}});
    if(!link||!link.supplier.active)throw Error('FOURNISSEUR_NON_REFERENCE');
    const pricing=normaliseSupplierUnitPrice(d.unitPrice,d.priceBasis,link.unitsPerPurchase);
    result=await tx.supplierPriceAgreement.create({data:{supplierId:d.supplierId,materialId:d.materialId,contractRef:d.contractRef,documentRef:d.documentRef,unitPrice:pricing.stockUnitPrice.toFixed(4),priceBasis:pricing.basis,priceBasisFactor:pricing.conversionFactor,sourceUnitPrice:pricing.sourceUnitPrice.toFixed(4),validFrom:new Date(d.validFrom+'T00:00:00Z'),validUntil:new Date(d.validUntil+'T23:59:59Z'),createdBy:actor.username}});
    entity='SupplierPriceAgreement';id=String((result as {id:number}).id);
   }else if(d.action==='approveAgreement'){
    const agreement=await tx.supplierPriceAgreement.findUnique({where:{id:d.agreementId},include:{supplier:true}});
    if(!agreement||agreement.status!=='pending')throw Error('CONTRAT_NON_VALIDABLE');
    if(agreement.createdBy===actor.username)throw Error('AUTO_APPROBATION_CONTRAT');
    if(!agreement.supplier.active||agreement.validUntil<new Date())throw Error('CONTRAT_EXPIRE');
    const materialLink=await tx.supplierMaterial.findUnique({where:{supplierId_materialId:{supplierId:agreement.supplierId,materialId:agreement.materialId}}});
    if(!materialLink)throw Error('FOURNISSEUR_NON_REFERENCE');
    if(!validPriceSourceConversion({priceBasis:agreement.priceBasis,priceBasisFactor:agreement.priceBasisFactor,sourceUnitPrice:agreement.sourceUnitPrice===null?null:Number(agreement.sourceUnitPrice),unitPrice:Number(agreement.unitPrice)},materialLink.unitsPerPurchase))throw Error('CONVERSION_INVALIDE');
    result=await tx.supplierPriceAgreement.update({where:{id:d.agreementId},data:{status:'approved',approvedBy:actor.username,approvedAt:new Date()}});
    entity='SupplierPriceAgreement';id=String(d.agreementId);
   }else if(d.action==='revokeAgreement'){
    const agreement=await tx.supplierPriceAgreement.findUnique({where:{id:d.agreementId}});
    if(!agreement||agreement.status!=='approved')throw Error('CONTRAT_NON_VALIDE');
    result=await tx.supplierPriceAgreement.update({where:{id:d.agreementId},data:{status:'revoked',revokedBy:actor.username,revokedAt:new Date(),revokeReason:d.reason}});
    entity='SupplierPriceAgreement';id=String(d.agreementId);
   }else if(d.action==='revision'){
    const order=await tx.supplierOrder.findUnique({where:{id:d.orderId},include:{lines:{include:{material:{select:{unit:true}}}},receipts:true}});
    if(!order||order.receipts.length||!['draft','confirmed'].includes(order.status))throw Error('BC_NON_MODIFIABLE');
    if(new Set(d.lines.map(l=>l.id)).size!==order.lines.length||d.lines.length!==order.lines.length||d.lines.some(l=>!order.lines.find(o=>o.id===l.id)))throw Error('LIGNES_DIFFERENTES');
    for(const line of order.lines){
      if(!(line.conversionFactor>0)||!Number.isFinite(line.conversionFactor))throw Error('CONVERSION_INVALIDE');
      const proposed=d.lines.find(l=>l.id===line.id)!;
      if(!isValidPurchaseQuantity(proposed.qty,line.material.unit)||!isValidPurchaseQuantity(proposed.qty/line.conversionFactor,line.purchaseUnit||line.material.unit))throw Error('QTE_UNITE_INVALIDE');
      // P5.15.21 RC (DEF-A-01, contre-audit final) : une révision ne peut pas
      // porter une ligne CONTRACT au-delà du plafond attribué dans une
      // consultation approuvée (sinon la révision contourne la garde
      // CONTRACT_AWARD_REQUIRED appliquée à la création du BC).
      if(line.priceSourceType==='CONTRACT'&&line.priceSourceId&&line.requestLineId){
        const chosen=await tx.supplierAwardContractAllocation.findMany({
          where:{agreementId:line.priceSourceId,plan:{status:'approved',rfq:{requestLineId:line.requestLineId}}},
          include:{plan:{select:{decidedBy:true,proposedBy:true}},agreement:{select:{unitPrice:true,status:true}}}
        });
        const approvedAlloc=chosen.filter(a=>a.plan.decidedBy&&a.plan.decidedBy!==a.plan.proposedBy&&a.agreement.status==='approved'&&Math.abs(Number(a.agreement.unitPrice)-proposed.unitPrice)<=0.0001);
        const allowedQty=approvedAlloc.reduce((n,a)=>n+a.qty,0);
        const used=await tx.supplierOrderLine.findMany({where:{requestLineId:line.requestLineId,priceSourceType:'CONTRACT',priceSourceId:line.priceSourceId,order:{status:{in:['draft','confirmed','partial','received','closed']}}},select:{qty:true}});
        const usedExcludingThis=used.reduce((n,l)=>n+l.qty,0)-line.qty;
        if(!approvedAlloc.length||usedExcludingThis+proposed.qty>allowedQty+0.000001)throw Error('CONTRACT_AWARD_REQUIRED');
      }
    }
    const before=JSON.stringify({status:order.status,lines:order.lines.map(l=>({id:l.id,qty:l.qty,purchaseQty:l.purchaseQty,conversionFactor:l.conversionFactor,unitPrice:l.unitPrice}))});
    const revisions=await tx.supplierOrderRevision.count({where:{orderId:d.orderId}});
    // Confirmation is withdrawn before changing the contract. A separate approver must approve again.
    const reverted=await tx.supplierOrder.updateMany({where:{id:d.orderId,status:order.status},data:{status:'draft',approvedBy:null}});
    if(reverted.count!==1)throw Error('BC_MODIFIE');
    for(const l of d.lines){
      const old=order.lines.find(x=>x.id===l.id)!;
      const newPurchaseQty=old.purchaseQty===null?null:l.qty/old.conversionFactor;
      if(newPurchaseQty!==null&&(!Number.isFinite(newPurchaseQty)||newPurchaseQty<=0))throw Error('CONVERSION_INVALIDE');
      await tx.supplierOrderLine.update({where:{id:l.id},data:{qty:l.qty,unitPrice:l.unitPrice,purchaseQty:newPurchaseQty}});
    }
    result=await tx.supplierOrderRevision.create({data:{orderId:d.orderId,revision:revisions+1,reason:d.reason,actor:actor.username,previousSnapshot:before,newSnapshot:JSON.stringify({status:'draft',lines:d.lines})}});
    entity='SupplierOrder';id=String(d.orderId);
   }else if(d.action==='schedule'){
    const order=await tx.supplierOrder.findUnique({where:{id:d.orderId}});if(!order||order.status==='closed')throw Error('BC_INTROUVABLE');
    result=await tx.supplierDeliverySchedule.create({data:{orderId:d.orderId,targetDate:new Date(d.targetDate),plannedQty:d.plannedQty,note:d.note,actor:actor.username}});
    entity='SupplierOrder';id=String(d.orderId);
   }else{
    if(await tx.supplierAwardPlan.count({where:{rfqId:d.rfqId,status:'pending'}}))throw Error('PLAN_EN_ATTENTE');
    const closed=await tx.supplierRFQ.updateMany({where:{id:d.rfqId,status:'open'},data:{status:'closed'}});
    result=closed;
    if(closed.count!==1)throw Error('RFQ_FERMEE');entity='SupplierRFQ';id=String(d.rfqId);
   }
   if(d.action==='offer'||d.action==='oralOffer'||d.action==='reviseOffer'||d.action==='confirmOffer'||d.action==='validatePhoneOffer'||d.action==='closeRfq'){
    const rfqId=d.action==='offer'||d.action==='oralOffer'||d.action==='closeRfq'?d.rfqId:
      (await tx.supplierQuoteOffer.findUnique({where:{id:d.offerId},select:{rfqId:true}}))?.rfqId;
    if(rfqId){const linked=await tx.supplierConsultationLine.findUnique({where:{rfqId}});
     if(linked){const lines=await tx.supplierConsultationLine.findMany({
      where:{consultationId:linked.consultationId},
      include:{rfq:{include:{offers:{select:{id:true}}}}}
     });
      const status=lines.every(x=>x.rfq.status==='awarded')?'awarded':lines.every(x=>['closed','awarded'].includes(x.rfq.status))?'closed':lines.some(x=>x.rfq.offers.length)?'in_progress':'prepared';
      await tx.supplierConsultation.update({where:{id:linked.consultationId},data:{status}});
     }}
   }
   await tx.auditEvent.create({data:{actor:actor.username,action:`P2P_${action.toUpperCase()}`,entity,entityId:id,details:JSON.stringify(d)}});
   return result;
  }));
  return NextResponse.json({result},{status:201});
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const errors:Record<string,string>={APPEL_DATE_FUTURE:'La date de l’appel ne peut pas être future',REFERENCE_EMAIL_REQUISE:'Saisissez la référence du nouveau message fournisseur',FOURNISSEUR_INTROUVABLE:'Fournisseur introuvable',MATIERE_INTROUVABLE:'Matière introuvable',DA_NON_VALIDEE:'DA non validée',RFQ_DEPASSE_DA:'Quantité consultée supérieure à la demande approuvée',RFQ_FERMEE:'Consultation fermée',FOURNISSEUR_NON_REFERENCE:'Fournisseur non référencé',FOURNISSEUR_NON_INVITE:'Fournisseur non invité à cette consultation',OFFRE_INTROUVABLE:'Offre introuvable',FOURNISSEUR_NON_QUALIFIE:'Fournisseur non qualifié',BC_NON_MODIFIABLE:'BC non modifiable après réception',LIGNES_DIFFERENTES:'Lignes du BC incohérentes',CONVERSION_INVALIDE:'Conversion d’unité d’achat invalide',BC_MODIFIE:'BC modifié en parallèle',BC_INTROUVABLE:'BC introuvable',DEVIS_EXPIRE:'Devis absent ou expiré',QTE_DEVIS_EXCESSIVE:'Quantité offerte supérieure à la consultation',UNITE_PRIX_REQUISE:'Sélectionnez si le prix correspond à l’unité de stock ou à l’unité d’achat',PRIX_UNITE_INVALIDE:'Prix fournisseur invalide',PDF_CONFIRMATION_REQUIS:'Un PDF du devis écrit doit être joint avant confirmation ou attribution',QTE_UNITE_INVALIDE:'Quantité invalide pour l’unité de la matière',FOURNISSEUR_SUSPENDU:'Fournisseur suspendu',AUTO_ATTRIBUTION:'Un autre responsable doit attribuer le devis',DATES_CONTRAT:'Dates contractuelles incohérentes',CONTRAT_NON_VALIDABLE:'Contrat absent ou non en attente',AUTO_APPROBATION_CONTRAT:'Le créateur du contrat ne peut pas l’approuver',CONTRAT_EXPIRE:'Contrat expiré ou fournisseur suspendu',CONTRAT_NON_VALIDE:'Accord non approuvé',OFFRE_ORALE_NON_CONFIRMEE:'Offre non encore validée par l’acheteur',OFFRE_ORALE_NON_VALIDEE:'Offre téléphonique non validée par l’acheteur avec compte rendu',AUTO_APPROBATION_OFFRE:'Le responsable doit être distinct de l’acheteur qui a enregistré ou validé l’offre',TRACE_APPEL_MANQUANTE:'Compte rendu téléphonique et interlocuteur obligatoires',CANAL_OFFRE_INCONNU:'Canal d’offre inconnu',OFFRE_NON_CONFIRMABLE:'Offre orale non confirmable',JUSTIFICATIF_ECRIT_REQUIS:'Joindre un PDF ou une référence de confirmation écrite',RFQ_DEJA_OUVERTE:'Une consultation est déjà ouverte pour cette ligne DA',RFQ_DEPASSE_RESTANT:'Quantité supérieure au reliquat de DA disponible (réceptions et BC en cours déduits)',DELAI_CONSULTATION_PASSE:'La date limite de consultation est dépassée',OFFRE_DEJA_EXISTANTE:'Une offre existe déjà pour ce fournisseur : validez l’offre téléphonique ou joignez le devis reçu ; sinon créez une reconsultation justifiée',UTILISER_PLAN_ATTRIBUTION:'Choisir et justifier les quantités dans le comparateur, puis faire approuver le plan par un responsable',OFFRE_NON_REVISABLE:'Cette offre ne peut pas être révisée après attribution',PLAN_EN_ATTENTE:'Un plan d’attribution existe : le rejeter avant révision',DATES_DEVIS_REQUISES:'Référence et date de validité du devis écrit obligatoires',CONTRACT_AWARD_REQUIRED:'Contrat non attribué dans une consultation approuvée ou quantité contractuelle déjà engagée',P2002:'Conflit de référence ou révision déjà enregistrée'};
  if(Object.prototype.hasOwnProperty.call(errors,code))return NextResponse.json({error:errors[code],code},{status:409});
  console.error('P2P sourcing transaction refused',safeErrorMetadata(e));
  return fail('Opération d’approvisionnement impossible');
 }
}
