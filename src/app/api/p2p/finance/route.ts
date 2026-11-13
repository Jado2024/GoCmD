import { safeErrorMetadata } from "@/lib/safe-server-error"
import { accessGate,currentActor,hasPermission } from '@/lib/access-gate';
import { db } from '@/lib/db';
import { NextRequest,NextResponse } from 'next/server';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import { invoiceBalanceCents, invoiceUnreservedCents, moneyToCents } from '@/lib/supplier-invoice-balance';
import { serializedSQLiteWrite } from '@/lib/sqlite-write';
import { approvedCoverageCents, creditRemainingCents } from '@/lib/supplier-credit-coverage';
const Money=z.number().finite().min(.01).max(1_000_000_000).refine(x=>Math.abs(x*100-Math.round(x*100))<1e-6,'Montant exprimé en centimes');
const S=z.discriminatedUnion('action',[
 z.object({action:z.literal('credit'),invoiceId:z.number().int().positive(),returnId:z.number().int().positive().optional(),amount:Money,reason:z.string().trim().min(10).max(500)}),
 z.object({action:z.literal('refund-credit'),invoiceId:z.number().int().positive(),returnId:z.number().int().positive().optional(),amount:Money,reason:z.string().trim().min(10).max(500)}),
 z.object({action:z.literal('approve-credit'),creditId:z.number().int().positive()}),
 z.object({action:z.literal('cancel-credit'),creditId:z.number().int().positive(),reason:z.string().trim().min(10).max(500)}),
 z.object({action:z.literal('reject-credit'),creditId:z.number().int().positive(),reason:z.string().trim().min(10).max(500)}),
 z.object({action:z.literal('settle-refund'),refundId:z.number().int().positive(),method:z.enum(['bank','offset']),reference:z.string().trim().min(3).max(100)}),
 z.object({action:z.literal('dispute'),supplierId:z.number().int().positive(),entityType:z.enum(['SupplierInvoice','SupplierOrder','GoodsReceipt','SupplierReturn']),entityId:z.number().int().positive(),category:z.enum(['price','quantity','quality','delivery','tax','other']),reason:z.string().min(10).max(1000)}),
 z.object({action:z.literal('resolve'),disputeId:z.number().int().positive(),resolution:z.string().min(10).max(1000)})
]);
export async function GET(req:NextRequest){
 const denied=accessGate(req,'finance');if(denied)return denied;
 if(currentActor(req)?.managed&&!hasPermission(req,'finance.purchases'))
  return NextResponse.json({error:'Lecture financière non autorisée'},{status:403,headers:{'Cache-Control':'no-store'}});
 // V18.9.2 (contre-audit F02/F05) : les avoirs sont exposés avec leur nature
 // (balance/refund), leur reste mobilisable et l'état de leur remboursement ;
 // les soldes par facture distinguent avoirs de solde et avoirs post-règlement.
 const [credits,disputes,invoices,refunds]=await Promise.all([
  db.supplierCreditNote.findMany({include:{allocations:{select:{amountCents:true}},refund:true},orderBy:{createdAt:'desc'},take:200}),
  db.supplierDispute.findMany({orderBy:{openedAt:'desc'},take:200}),
  db.supplierInvoice.findMany({include:{credits:true,payments:true},orderBy:{createdAt:'desc'},take:200}),
  db.supplierRefund.findMany({orderBy:{createdAt:'desc'},take:200})]);
 return NextResponse.json({credits:credits.map(x=>({...x,amount:String(x.amount),remainingCents:creditRemainingCents(x)})),disputes,refunds:refunds.map(r=>({...r,amount:String(r.amount)})),balances:invoices.map(i=>{
   const paidCents=i.payments.reduce((s,p)=>s+moneyToCents(p.amount),0);
   const approvedBalance=i.credits.filter(c=>c.status==='approved'&&c.kind==='balance');
   const creditedCents=approvedBalance.reduce((s,c)=>s+moneyToCents(c.amount),0);
   const balance=moneyToCents(i.totalAmount)-paidCents-creditedCents;
   const refundPendingCents=i.credits.filter(c=>c.kind==='refund'&&c.status==='approved').reduce((s,c)=>s+moneyToCents(c.amount),0);
   const refundDraftCents=i.credits.filter(c=>c.kind==='refund'&&c.status==='draft').reduce((s,c)=>s+moneyToCents(c.amount),0);
   const balanceCredits=i.credits.filter(c=>c.kind==='balance');
   return {invoiceId:i.id,supplierId:i.supplierId,total:String(i.totalAmount),paid:(paidCents/100).toFixed(2),credited:(creditedCents/100).toFixed(2),pendingCredits:i.credits.filter(c=>c.status==='draft').length,availableToReserve:(Math.max(0,invoiceUnreservedCents(i.totalAmount,i.payments.map(p=>p.amount),balanceCredits))/100).toFixed(2),outstanding:(Math.max(0,balance)/100).toFixed(2),overpayment:(Math.max(0,-balance)/100).toFixed(2),refundPending:(refundPendingCents/100).toFixed(2),refundDraft:(refundDraftCents/100).toFixed(2),refundable:(Math.max(0,paidCents-refundPendingCents-refundDraftCents)/100).toFixed(2),status:i.status,creditAvailableCents:approvedCoverageCents(i.credits)}})});
}
export async function POST(req:NextRequest){
 const denied=accessGate(req,'finance');if(denied)return denied;
 const actor=currentActor(req)!.username;
 const parsed=S.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Données financières invalides',details:parsed.error.flatten()},{status:400});
 const d=parsed.data;
 try{
  const res=await serializedSQLiteWrite(() => db.$transaction(async tx=>{
   let entity='',entityId='';let result:unknown;
   if(d.action==='credit'){
    const inv=await tx.supplierInvoice.findUnique({where:{id:d.invoiceId},include:{credits:true,payments:true}});
    if(!inv||!['approved','paid'].includes(inv.status))throw Error('FACTURE_NON_APPROUVEE');
    // Payments already booked also consume the invoice's remaining balance.
    // V18.9.2 (F02) : seuls les avoirs de SOLDE consomment le reste à payer ;
    // les avoirs post-règlement (refund) sont des créances séparées.
    const remainingCents=invoiceBalanceCents(inv.totalAmount,inv.payments.map(p=>p.amount),inv.credits.filter(c=>['draft','approved'].includes(c.status)&&c.kind==='balance').map(c=>c.amount));
    const amountCents=moneyToCents(d.amount);
    if(remainingCents<=0||amountCents>remainingCents)throw Error('AVOIR_SUPERIEUR_SOLDE');
    if(d.returnId){const ret=await tx.supplierReturn.findUnique({where:{id:d.returnId}});if(!ret||ret.supplierId!==inv.supplierId)throw Error('RETOUR_INCOMPATIBLE');const duplicates=await tx.supplierCreditNote.count({where:{returnId:d.returnId,status:{in:['draft','approved']}}});if(duplicates)throw Error('RETOUR_DEJA_CREDITE');}
    // Atomically reserve draft capacity across workers, including concurrent credit requests.
    const reserved=await tx.supplierInvoice.updateMany({where:{id:inv.id,status:inv.status,version:inv.version},data:{version:{increment:1}}});
    if(reserved.count!==1)throw Error('FACTURE_MODIFIEE');
    const ref=`AV-${new Date().getUTCFullYear()}-${randomUUID().slice(0,10).toUpperCase()}`;
    // The preparer cannot approve their own credit. Drafts never affect invoice balances.
    result=await tx.supplierCreditNote.create({data:{ref,invoiceId:inv.id,supplierId:inv.supplierId,returnId:d.returnId??null,amount:d.amount.toFixed(2),reason:d.reason,status:'draft',kind:'balance',actor}});
    entity='SupplierInvoice';entityId=String(inv.id);
   }else if(d.action==='refund-credit'){
    // V18.9.2 (contre-audit F02) : avoir APRÈS RÈGLEMENT INTÉGRAL. Une facture
    // entièrement réglée n'a plus de solde à réduire : détourner le plafond du
    // solde à payer rendait tout retour post-paiement impossible. Ce circuit
    // distinct crée une créance de remboursement fournisseur, avec la même
    // approbation à quatre-yeux que les avoirs de solde (le préparateur ne
    // peut pas approuver), plafonnée par ce qui a réellement été réglé et pas
    // encore remboursé (brouillons inclus : ils réservent la capacité).
    const inv=await tx.supplierInvoice.findUnique({where:{id:d.invoiceId},include:{credits:true,payments:true}});
    if(!inv||!['approved','paid'].includes(inv.status))throw Error('FACTURE_NON_APPROUVEE');
    const paidCents=inv.payments.reduce((s,p)=>s+moneyToCents(p.amount),0);
    const outstandingCents=invoiceBalanceCents(inv.totalAmount,inv.payments.map(p=>p.amount),inv.credits.filter(c=>c.status==='approved'&&c.kind==='balance').map(c=>c.amount));
    if(outstandingCents>0)throw Error('FACTURE_NON_SOLDEE');
    const alreadyRefundedCents=inv.credits.filter(c=>c.kind==='refund'&&['draft','approved'].includes(c.status)).reduce((s,c)=>s+moneyToCents(c.amount),0);
    const refundableCents=paidCents-alreadyRefundedCents;
    const amountCents=moneyToCents(d.amount);
    if(refundableCents<=0||amountCents>refundableCents)throw Error('AVOIR_REMBOURSEMENT_IMPOSSIBLE');
    if(d.returnId){const ret=await tx.supplierReturn.findUnique({where:{id:d.returnId}});if(!ret||ret.supplierId!==inv.supplierId)throw Error('RETOUR_INCOMPATIBLE');const duplicates=await tx.supplierCreditNote.count({where:{returnId:d.returnId,status:{in:['draft','approved']}}});if(duplicates)throw Error('RETOUR_DEJA_CREDITE');}
    const ref=`AVR-${new Date().getUTCFullYear()}-${randomUUID().slice(0,10).toUpperCase()}`;
    result=await tx.supplierCreditNote.create({data:{ref,invoiceId:inv.id,supplierId:inv.supplierId,returnId:d.returnId??null,amount:d.amount.toFixed(2),reason:d.reason,status:'draft',kind:'refund',actor}});
    entity='SupplierInvoice';entityId=String(inv.id);
   }else if(d.action==='approve-credit'||d.action==='reject-credit'||d.action==='cancel-credit'){
    const credit=await tx.supplierCreditNote.findUnique({where:{id:d.creditId},include:{refund:true}});
    if(!credit||credit.status!=='draft')throw Error('AVOIR_NON_BROUILLON');
    if(d.action==='approve-credit'&&credit.actor===actor)throw Error('AVOIR_AUTO_APPROBATION');
    if(d.action==='reject-credit'&&credit.actor===actor)throw Error('AVOIR_REFUS_PAR_AUTEUR');
    if(d.action==='cancel-credit'&&credit.actor!==actor)throw Error('AVOIR_ANNULATION_NON_AUTORISEE');
    if(d.action==='approve-credit'){
      const inv=await tx.supplierInvoice.findUnique({where:{id:credit.invoiceId},include:{payments:true,credits:true}});
      if(!inv||!['approved','paid'].includes(inv.status))throw Error('FACTURE_NON_APPROUVEE');
      const creditCents=moneyToCents(credit.amount);
      if(credit.kind==='refund'){
       // Avoir post-règlement : recontroler au moment de l'approbation ce qui
       // a été réellement réglé et pas encore remboursé (F02).
       const paidCents=inv.payments.reduce((s,p)=>s+moneyToCents(p.amount),0);
       const outstandingCents=invoiceBalanceCents(inv.totalAmount,inv.payments.map(p=>p.amount),inv.credits.filter(c=>c.status==='approved'&&c.kind==='balance').map(c=>c.amount));
       if(outstandingCents>0)throw Error('FACTURE_NON_SOLDEE');
       const alreadyRefundedCents=inv.credits.filter(c=>c.kind==='refund'&&c.status==='approved'&&c.id!==credit.id).reduce((s,c)=>s+moneyToCents(c.amount),0);
       if(paidCents-alreadyRefundedCents<creditCents)throw Error('AVOIR_REMBOURSEMENT_IMPOSSIBLE');
       const changed=await tx.supplierCreditNote.updateMany({where:{id:credit.id,status:'draft'},data:{status:'approved',decisionActor:actor,decidedAt:new Date()}});
       if(changed.count!==1)throw Error('AVOIR_MODIFIE');
       // La facture reste « paid » : l'avoir post-règlement ne touche pas au
       // solde (déjà nul) ; il ouvre une CRÉANCE de remboursement fournisseur
       // suivie jusqu'à son remboursement effectif (rapprochement comptable).
       result=await tx.supplierRefund.create({data:{creditNoteId:credit.id,supplierId:credit.supplierId,amount:credit.amount,status:'pending',actor}});
       entity='SupplierCreditNote';entityId=String(credit.id);
      }else{
       // Recheck the available amount at approval time, after any intervening payment or credit.
       const remainingCents=invoiceBalanceCents(inv.totalAmount,inv.payments.map(p=>p.amount),inv.credits.filter(c=>c.status==='approved'&&c.kind==='balance'&&c.id!==credit.id).map(c=>c.amount));
       if(remainingCents<=0||creditCents>remainingCents)throw Error('AVOIR_SUPERIEUR_SOLDE');
       const changed=await tx.supplierCreditNote.updateMany({where:{id:credit.id,status:'draft'},data:{status:'approved',decisionActor:actor,decidedAt:new Date()}});
       if(changed.count!==1)throw Error('AVOIR_MODIFIE');
       // Every balance mutation bumps the version, even if approval is partial.
       const updated=await tx.supplierInvoice.updateMany({where:{id:inv.id,status:inv.status,version:inv.version},data:{version:{increment:1},...(creditCents===remainingCents?{status:'paid'}:{})}});
       if(updated.count!==1)throw Error('FACTURE_MODIFIEE');
       result=await tx.supplierCreditNote.findUnique({where:{id:credit.id}});
       entity='SupplierCreditNote';entityId=String(credit.id);
      }
    }else{
      const status=d.action==='cancel-credit'?'cancelled':'rejected';
      const changed=await tx.supplierCreditNote.updateMany({where:{id:credit.id,status:'draft'},data:{status,decisionActor:actor,decisionReason:d.reason,decidedAt:new Date()}});
      if(changed.count!==1)throw Error('AVOIR_MODIFIE');
      const inv=await tx.supplierInvoice.findUniqueOrThrow({where:{id:credit.invoiceId}});
      const touch=await tx.supplierInvoice.updateMany({where:{id:inv.id,version:inv.version},data:{version:{increment:1}}});
      if(touch.count!==1)throw Error('FACTURE_MODIFIEE');
      result=await tx.supplierCreditNote.findUnique({where:{id:credit.id}});
      entity='SupplierCreditNote';entityId=String(credit.id);
    }
   }else if(d.action==='settle-refund'){
    // V18.9.2 (contre-audit F02) : solder la créance de remboursement —
    // virement bancaire (bank) ou imputation sur une transaction ultérieure
    // (offset). Le PRÉPARATEUR de l'avoir ne peut pas solder sa propre
    // demande : la trace de rapprochement reste indépendante (quatre-yeux).
    // Audit 10/11/2026 (FIN-4E-01) : l'APPROBATEUR de l'avoir est également
    // exclu — sur un avoir « refund », son approbation CRÉE la créance ; lui
    // laisser solder le virement concentrait décision et exécution de la
    // sortie de fonds sur la même personne.
    const refund=await tx.supplierRefund.findUnique({where:{id:d.refundId},include:{creditNote:true}});
    if(!refund||refund.status!=='pending')throw Error('REMBOURSEMENT_INTROUVABLE');
    if(refund.creditNote.status!=='approved')throw Error('REMBOURSEMENT_INTROUVABLE');
    if(refund.creditNote.actor===actor)throw Error('REMBOURSEMENT_AUTO');
    if(refund.creditNote.decisionActor===actor)throw Error('REMBOURSEMENT_AUTO');
    const changed=await tx.supplierRefund.updateMany({where:{id:refund.id,status:'pending'},data:{status:'refunded',method:d.method,reference:d.reference,refundActor:actor,refundedAt:new Date()}});
    if(changed.count!==1)throw Error('REMBOURSEMENT_MODIFIE');
    result=await tx.supplierRefund.findUnique({where:{id:refund.id}});
    entity='SupplierRefund';entityId=String(refund.id);
   }else if(d.action==='dispute'){
    const s=await tx.supplier.findUnique({where:{id:d.supplierId}});if(!s)throw Error('FOURNISSEUR_INTROUVABLE');
    const linked=await ({SupplierInvoice:()=>tx.supplierInvoice.findFirst({where:{id:d.entityId,supplierId:s.id}}),SupplierOrder:()=>tx.supplierOrder.findFirst({where:{id:d.entityId,supplierId:s.id}}),GoodsReceipt:()=>tx.goodsReceipt.findFirst({where:{id:d.entityId,supplierOrder:{supplierId:s.id}}}),SupplierReturn:()=>tx.supplierReturn.findFirst({where:{id:d.entityId,supplierId:s.id}})}[d.entityType]());
    if(!linked)throw Error('DOCUMENT_FOURNISSEUR_INCORRECT');
    result=await tx.supplierDispute.create({data:{supplierId:d.supplierId,entityType:d.entityType,entityId:d.entityId,category:d.category,reason:d.reason,openedBy:actor}});
    entity='SupplierDispute';entityId=String((result as {id:number}).id);
   }else{
    const dispute=await tx.supplierDispute.findUnique({where:{id:d.disputeId}});
    if(!dispute||dispute.status!=='open'||dispute.openedBy===actor)throw Error('LITIGE_NON_RESOLUBLE');
    const changed=await tx.supplierDispute.updateMany({where:{id:d.disputeId,status:'open'},data:{status:'resolved',resolution:d.resolution,resolvedBy:actor,resolvedAt:new Date()}});
    if(changed.count!==1)throw Error('LITIGE_DEJA_RESOLU');
    result=await tx.supplierDispute.findUnique({where:{id:d.disputeId}});
    entity='SupplierDispute';entityId=String(d.disputeId);
   }
   await tx.auditEvent.create({data:{actor,action:`P2P_${d.action.toUpperCase().replaceAll('-','_')}`,entity,entityId,details:JSON.stringify(d)}});
   return result;
  }));return NextResponse.json({result:res},{status:201});
 }catch(e){
   const code=e instanceof Error?e.message:'';
   const known:Record<string,string>={FACTURE_NON_APPROUVEE:'Facture non approuvée',FACTURE_NON_SOLDEE:'Avoir post-règlement réservé aux factures entièrement réglées',AVOIR_SUPERIEUR_SOLDE:'Avoir supérieur au solde non réglé',AVOIR_REMBOURSEMENT_IMPOSSIBLE:'Avoir post-règlement supérieur au montant réglé et pas encore remboursé',REMBOURSEMENT_INTROUVABLE:'Créance de remboursement introuvable, déjà soldée ou avoir non approuvé',REMBOURSEMENT_AUTO:'Ni le préparateur ni l\'approbateur de l\'avoir ne peuvent solder le remboursement',REMBOURSEMENT_MODIFIE:'Remboursement modifié en parallèle',RETOUR_INCOMPATIBLE:'Retour fournisseur incompatible',RETOUR_DEJA_CREDITE:'Retour déjà crédité',AVOIR_NON_BROUILLON:'Avoir déjà traité ou introuvable',AVOIR_AUTO_APPROBATION:'Une autre personne du service finances doit approuver cet avoir',AVOIR_REFUS_PAR_AUTEUR:'Utilisez Annuler pour retirer votre brouillon',AVOIR_ANNULATION_NON_AUTORISEE:'Seul le préparateur peut annuler son brouillon',AVOIR_MODIFIE:'Avoir modifié en parallèle',LITIGE_NON_RESOLUBLE:'Litige non résoluble par son créateur',LITIGE_DEJA_RESOLU:'Litige déjà résolu',FACTURE_MODIFIEE:'Facture modifiée en parallèle',FOURNISSEUR_INTROUVABLE:'Fournisseur introuvable',DOCUMENT_FOURNISSEUR_INCORRECT:'Document ne correspondant pas au fournisseur'};
   if(Object.prototype.hasOwnProperty.call(known,code))return NextResponse.json({error:known[code],code},{status:409});
   console.error('P2P finance transaction refused',safeErrorMetadata(e));
   return NextResponse.json({error:'Opération financière impossible'},{status:409});
 }
}
