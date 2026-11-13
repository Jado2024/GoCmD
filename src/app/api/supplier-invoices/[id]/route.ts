import { safeErrorMetadata } from "@/lib/safe-server-error"
import { accessGate,currentActor } from "@/lib/access-gate"
import { db } from "@/lib/db"
import { NextRequest,NextResponse } from "next/server"
import { z } from "zod"
import { invoiceBalanceCents, invoiceUnreservedCents, moneyToCents } from "@/lib/supplier-invoice-balance"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
const S=z.discriminatedUnion("action",[z.object({action:z.literal("approve")}),z.object({action:z.literal("payment"),reference:z.string().trim().min(3).max(100),amount:z.number().finite().min(0.01).max(1_000_000_000)}),z.object({action:z.literal("reject"),reason:z.string().trim().min(10).max(500)})])
export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){
 const denied=accessGate(req,"finance");if(denied)return denied
 const actor=currentActor(req)!.username,id=Number((await ctx.params).id)
 if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:"Identifiant invalide"},{status:400})
 const p=S.safeParse(await req.json().catch(()=>null));if(!p.success)return NextResponse.json({error:"Action invalide"},{status:400})
 try{
  const result=await serializedSQLiteWrite(() => db.$transaction(async tx=>{
   const inv=await tx.supplierInvoice.findUnique({where:{id},include:{payments:true,credits:true}})
   if(!inv)throw new Error("MISSING")
   if(p.data.action==="approve"){
    if(inv.status!=="matched"||inv.createdBy===actor)throw new Error("INVALID_APPROVAL")
    const changed=await tx.supplierInvoice.updateMany({where:{id,status:"matched"},data:{status:"approved",approvedBy:actor,version:{increment:1}}})
    if(changed.count!==1)throw new Error("CONCURRENT")
    await tx.auditEvent.create({data:{actor,action:"SUPPLIER_INVOICE_APPROVED",entity:"SupplierInvoice",entityId:String(id)}})
    return {id,status:"approved"}
   }
   // V18.9.1 (contre-audit A-05) : sortie contrôlée pour une facture bloquée
   // par un écart de prix/quantité. Le rejet est motivé et attribué à un
   // comptable DIFFÉRENT de l'enregistreur (quatre-yeux) ; les lignes ne
   // comptent plus comme facturé, ce qui permet de ressaisir la facture
   // rectifiée du fournisseur et de la rapprocher à nouveau.
   if(p.data.action==="reject"){
    if(inv.status!=="blocked")throw new Error("NOT_BLOCKED")
    if(inv.createdBy===actor)throw new Error("SELF_REJECTION")
    const changed=await tx.supplierInvoice.updateMany({where:{id,status:"blocked",version:inv.version},data:{status:"rejected",rejectedBy:actor,rejectionReason:p.data.reason,version:{increment:1}}})
    if(changed.count!==1)throw new Error("CONCURRENT")
    await tx.auditEvent.create({data:{actor,action:"SUPPLIER_INVOICE_REJECTED",entity:"SupplierInvoice",entityId:String(id),details:JSON.stringify({reason:p.data.reason,invoiceNumber:inv.invoiceNumber})}})
    return {id,status:"rejected",reason:p.data.reason}
   }
   if(!["approved","paid"].includes(inv.status))throw new Error("NOT_APPROVED")
   if(inv.createdBy===actor)throw new Error("SELF_PAYMENT")
   const remainingCents=invoiceBalanceCents(inv.totalAmount,inv.payments.map(p=>p.amount),inv.credits.filter(c=>c.status==='approved'&&c.kind==='balance').map(c=>c.amount))
   const paidCents=moneyToCents(p.data.amount)
   // A prepared (unapproved) credit reserves capacity. Payments must not
   // consume this pending amount; otherwise a two-person approval could be blocked.
   // V18.9.2 (F02) : seuls les avoirs de SOLDE réservent la capacité de
   // paiement — les avoirs post-règlement sont des créances distinctes.
   const unreservedCents=invoiceUnreservedCents(inv.totalAmount,inv.payments.map(p=>p.amount),inv.credits.filter(c=>c.kind==='balance'))
   if(remainingCents<=0||unreservedCents<=0||paidCents>unreservedCents)throw new Error("OVERPAYMENT_OR_RESERVED")
   const finished=paidCents===remainingCents
   // Every payment, including partial payments, must atomically bump the version.
   // A concurrent writer using the same read snapshot cannot silently overpay.
   const changed=await tx.supplierInvoice.updateMany({where:{id,status:inv.status,version:inv.version},data:{version:{increment:1},...(finished?{status:"paid"}:{})}})
   if(changed.count!==1)throw new Error("CONCURRENT")
   await tx.supplierPayment.create({data:{invoiceId:id,reference:p.data.reference,actor,amount:p.data.amount.toFixed(2)}})
   await tx.auditEvent.create({data:{actor,action:"SUPPLIER_PAYMENT_RECORDED",entity:"SupplierInvoice",entityId:String(id),details:JSON.stringify({reference:p.data.reference,amount:p.data.amount})}})
   return {id,status:finished?"paid":"approved",balance:((remainingCents-paidCents)/100).toFixed(2)}
  }))
  return NextResponse.json(result)
 }catch(e){
  if(e instanceof Error){
   const messages:Record<string,string>={MISSING:"Facture introuvable",INVALID_APPROVAL:"Approbation réservée à une facture rapprochée, par un autre comptable",NOT_APPROVED:"Paiement réservé aux factures approuvées",SELF_PAYMENT:"Un autre comptable doit enregistrer le règlement",NOT_BLOCKED:"Le rejet motivé est réservé aux factures bloquées par écart",SELF_REJECTION:"Le rejet motivé doit être confirmé par un autre comptable que celui qui a enregistré la facture",CONCURRENT:"Facture modifiée en parallèle : actualiser puis réessayer"}
   if(Object.prototype.hasOwnProperty.call(messages,e.message))return NextResponse.json({error:messages[e.message],code:e.message},{status:409})
  }
  console.error("[supplier-invoices:id] erreur non mappée:",safeErrorMetadata(e));return NextResponse.json({error:"Validation/paiement refusé : statut, séparation des tâches, montant ou référence incorrects"},{status:409})
 }
}
