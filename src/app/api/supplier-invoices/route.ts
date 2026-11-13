import {readDocumentPage,documentPagination} from "@/lib/document-register"
import { accessGate,currentActor,hasPermission } from "@/lib/access-gate"
import { p2pConflictResponse } from "@/lib/p2p-api-errors"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { isValidPurchaseQuantity } from "@/lib/purchase-quantity"
import {supplierInvoicePolicyIssues} from "@/lib/purchase-invoice-policy"
import { db } from "@/lib/db"
import { NextRequest,NextResponse } from "next/server"
import { z } from "zod"
const Line=z.object({receiptLineId:z.number().int().positive(),qty:z.number().finite().positive().max(1_000_000),unitPrice:z.number().finite().min(0).max(1_000_000_000),taxRate:z.number().finite().min(0).max(100).default(0)})
// V18.9.2 (contre-audit F06) : la saisie rectifiée d'une facture rejetée porte
// un NUMÉRO DISTINCT (l'unicité [fournisseur, numéro] est conservée : jamais
// de réutilisation du numéro rejeté) et déclare explicitement la facture
// remplacée. Le remplacement n'est accepté que si la facture visée est au
// statut « rejected » (rejet motivé V18.9.1) et du même fournisseur.
const S=z.object({supplierId:z.number().int().positive(),invoiceNumber:z.string().trim().min(2).max(80),invoiceDate:z.iso.date(),currency:z.literal("MAD").default("MAD"),freightAmount:z.number().finite().min(0).max(1_000_000).default(0),replacesInvoiceId:z.number().int().positive().optional(),lines:z.array(Line).min(1).max(200)})
export async function GET(req:NextRequest){
 const denied=accessGate(req,"finance");if(denied)return denied
 if(currentActor(req)?.managed&&!hasPermission(req,"finance.purchases"))
  return NextResponse.json({error:"Lecture des factures fournisseurs non autorisée"},{status:403,headers:{"Cache-Control":"no-store"}})
 const params=req.nextUrl.searchParams
 const register=params.get("view")==="register"
 const {page,pageSize,q,take,skip}=readDocumentPage(params)
 const status=params.get("status")
 const supplierId=Number(params.get("supplierId")??0)
 const where={
  ...(Number.isSafeInteger(supplierId)&&supplierId>0?{supplierId}:{}),
  ...(status&&["blocked","matched","approved","paid","draft","rejected"].includes(status)?{status}:{}),
  ...(q?{OR:[{invoiceNumber:{contains:q}},{supplier:{name:{contains:q}}}]}:{}),
 }
 const dir=params.get("dir")==="asc"?"asc":"desc"
 const sort=params.get("sort")
 const [items,total]=await Promise.all([
  db.supplierInvoice.findMany({where,include:{supplier:true,lines:{include:{receiptLine:true}},payments:true,replacesInvoice:{select:{id:true,invoiceNumber:true,status:true,rejectionReason:true}},replacedBy:{select:{id:true,invoiceNumber:true,status:true,rejectionReason:true}}},
   orderBy:[sort==="facture"?{invoiceNumber:dir}:sort==="total"?{totalAmount:dir}:{createdAt:dir},{id:"desc"}],
   take:register?take:200,skip:register?skip:0}),
  register?db.supplierInvoice.count({where}):Promise.resolve(0),
 ])
 return NextResponse.json({pagination:register?documentPagination(page,pageSize,total):undefined,
  items:items.map(i=>({...i,totalAmount:String(i.totalAmount),freightAmount:String(i.freightAmount),
   lines:i.lines.map(l=>({...l,unitPrice:String(l.unitPrice),taxRate:String(l.taxRate)})),
   payments:i.payments.map(p=>({...p,amount:String(p.amount)}))}))})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req,"finance");if(denied)return denied
 const actor=currentActor(req)!.username
 const p=S.safeParse(await req.json().catch(()=>null));if(!p.success)return NextResponse.json({error:"Facture invalide",details:p.error.flatten()},{status:400})
 const d=p.data
 if(new Set(d.lines.map(l=>l.receiptLineId)).size!==d.lines.length)return NextResponse.json({error:"Ligne de BR répétée"},{status:400})
 try{
  const created=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   // V18.9.2 (contre-audit F06) : contrôle du lien de remplacement AVANT tout
   // calcul — la facture remplacée doit exister, appartenir au même fournisseur
   // et être REJETÉE (rejet motivé, quatre-yeux). Une facture bloquée doit
   // d'abord passer par le rejet motivé : le lien n'est pas un contournement.
   if(d.replacesInvoiceId){
    const replaced=await tx.supplierInvoice.findUnique({where:{id:d.replacesInvoiceId}})
    if(!replaced||replaced.supplierId!==d.supplierId)throw new Error("REPLACED_INVOICE_MISMATCH")
    if(replaced.status!=="rejected")throw new Error("REPLACED_INVOICE_NOT_REJECTED")
   }
   const lines=await tx.goodsReceiptLine.findMany({where:{id:{in:d.lines.map(l=>l.receiptLineId)}},include:{supplierOrderLine:{include:{order:true,material:{select:{unit:true}}}}}})
   if(lines.length!==d.lines.length||lines.some(l=>l.supplierOrderLine.order.supplierId!==d.supplierId))throw new Error("FOREIGN_RECEIPT")
   const issues:string[]=[]
   // Arrondi par ligne au centime, identique au journal comptable CSV :
   // le total de la facture est toujours égal à la somme des lignes du journal.
   let totalCents=0
   for(const item of d.lines){
    const rl=lines.find(l=>l.id===item.receiptLineId)!
    // P5.15.21 (VAL-001) : quantité facturée compatible avec l'unité de stock
    // de la ligne de BR — plus de fraction sur unité indivisible (0,5 pièce)
    // ni d'arrondi silencieux au-delà du millième. Même règle que les DA/BC/
    // BR/retours (isValidPurchaseQuantity), jusqu'ici absente des factures.
    if(!isValidPurchaseQuantity(item.qty, rl.supplierOrderLine.material.unit))throw new Error("INVALID_UNIT_QTY")
    const older=await tx.supplierInvoiceLine.findMany({where:{receiptLineId:rl.id},include:{invoice:true}})
    // V18.9.1 (contre-audit A-05) : une facture rejetée ne consomme plus le
    // facturable du BR (la facture rectifiée peut être ressaisie).
    const already=older.filter(l=>!["blocked","rejected"].includes(l.invoice.status)).reduce((s,l)=>s+l.qty,0)
    if(item.qty+already>rl.acceptedQty-rl.returnedQty+0.000001)issues.push(`BR line ${rl.id}: quantity above accepted`)
    const bcPrice=rl.supplierOrderLine.unitPrice
    if(Math.abs(item.unitPrice-bcPrice)>Math.max(0.01,bcPrice*0.01))issues.push(`BR line ${rl.id}: price variance above 1%`)
    // RR-10: compute from the EXACT four-decimal unit price we persist,
    // never from a higher-precision input that is silently truncated later.
    const storedPrice=Number(item.unitPrice.toFixed(4))
    const htCents=Math.round(item.qty*storedPrice*100)
    const taxCents=Math.round(htCents*item.taxRate/100)
    // V18.9.1 (contre-audit A-07) : aucun montant hors entiers sûrs JavaScript
    // ne doit atteindre la base (qty et prix unitaire plafonnés séparément
    // peuvent pourtant produire 10^17 centimes).
    if(!Number.isSafeInteger(htCents)||!Number.isSafeInteger(taxCents))throw new Error("AMOUNT_UNSAFE")
    totalCents+=htCents+taxCents
   }
   const goodsCents=totalCents
   const freightCents=Math.round(d.freightAmount*100)
   if(!Number.isSafeInteger(freightCents)||!Number.isSafeInteger(totalCents+freightCents))throw new Error("AMOUNT_UNSAFE")
   // In a real deployment, hold invoices with unapproved VAT or freight;
   // never invent local tax law or silently accept an unbounded freight amount.
   // Disposable demo data are exempt from mandatory setup but still honor
   // any explicit accounting policy supplied by the operator.
   issues.push(...supplierInvoicePolicyIssues({
     taxRates:d.lines.map(l=>l.taxRate),freightCents,goodsCents,
     approvedTaxRatesBps:process.env.GOCMD_PURCHASE_TAX_RATES_BPS,
     maxFreightBps:process.env.GOCMD_PURCHASE_FREIGHT_MAX_BPS,
     strict:process.env.NODE_ENV==="production" && process.env.GOCMD_ALLOW_DEMO_DB!=="1",
   }))
   totalCents+=freightCents
   const total=(totalCents/100).toFixed(2)
   const status=issues.length?"blocked":"matched"
   const invoice=await tx.supplierInvoice.create({data:{supplierId:d.supplierId,invoiceNumber:d.invoiceNumber.trim().toUpperCase(),invoiceDate:new Date(d.invoiceDate+"T00:00:00Z"),currency:d.currency,status,totalAmount:total,freightAmount:d.freightAmount.toFixed(2),discrepancy:issues.join(" ; ")||null,createdBy:actor,replacesInvoiceId:d.replacesInvoiceId??null,lines:{create:d.lines.map(l=>({receiptLineId:l.receiptLineId,orderLineId:lines.find(x=>x.id===l.receiptLineId)!.supplierOrderLineId,qty:l.qty,unitPrice:l.unitPrice.toFixed(4),taxRate:l.taxRate.toFixed(4)}))}}})
   await tx.auditEvent.create({data:{actor,action:"SUPPLIER_INVOICE_REGISTERED",entity:"SupplierInvoice",entityId:String(invoice.id),details:JSON.stringify({status,issues,replacesInvoiceId:d.replacesInvoiceId??null})}})
   return {id:invoice.id,status,issues,totalAmount:total,replacesInvoiceId:d.replacesInvoiceId??null}
  }))
  return NextResponse.json(created,{status:201})
 }catch(e){return p2pConflictResponse(e,INVOICE_ERRORS,"Facture fournisseur")}
}

const INVOICE_ERRORS: Record<string,string> = {
 FOREIGN_RECEIPT:"Ligne de BR absente ou appartenant à un autre fournisseur",
 INVALID_UNIT_QTY:"Quantité facturée incompatible avec l'unité de stock de la ligne de BR (entier requis pour une unité indivisible)",
 REPLACED_INVOICE_MISMATCH:"Facture remplacée introuvable ou d'un autre fournisseur",
 REPLACED_INVOICE_NOT_REJECTED:"Seule une facture REJETÉE (rejet motivé) peut être déclarée remplacée",
 AMOUNT_UNSAFE:"Montant hors limites arithmétiques sûres : réduire la quantité ou le prix unitaire",
 P2002:"Facture fournisseur déjà enregistrée : vérifier le fournisseur et son numéro",
}
