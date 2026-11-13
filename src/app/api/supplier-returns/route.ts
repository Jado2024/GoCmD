import {assertStockUnreserved} from "@/lib/sales-stock-reservation"
import { movePlacement } from "@/lib/p2p-placements"
import { p2pConflictResponse } from "@/lib/p2p-api-errors"
import { accessGate,currentActor,canSeeMaterialCosts } from "@/lib/access-gate"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { db } from "@/lib/db"
import { nextRef } from "@/lib/erp-server"
import { planCreditAllocation, type CreditAllocationPlanEntry } from "@/lib/supplier-credit-coverage"
import { NextRequest,NextResponse } from "next/server"
import { z } from "zod"
import { isValidPurchaseQuantity } from "@/lib/purchase-quantity"
import { invoicedCentsForQty } from "@/lib/invoiced-valuation"
const S=z.object({stockLotId:z.number().int().positive(),qty:z.number().finite().positive(),reason:z.string().trim().min(10).max(300),creditExpected:z.boolean().default(true)})
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 const pricing=canSeeMaterialCosts(req)
 const items=await db.supplierReturn.findMany({include:{supplier:true,stockLot:true,creditAllocations:{include:{creditNote:{select:{ref:true,kind:true,amount:true}}}}},orderBy:{createdAt:"desc"},take:200})
 if(pricing)return NextResponse.json({items})
 // Quality/warehouse users may follow quantities and lots, not credit amounts or supplier contacts.
 return NextResponse.json({items:items.map(r=>({
  id:r.id,ref:r.ref,supplierId:r.supplierId,stockLotId:r.stockLotId,qty:r.qty,
  reason:r.reason,actor:r.actor,createdAt:r.createdAt,creditExpected:r.creditExpected,
  supplier:{id:r.supplier.id,name:r.supplier.name},
  stockLot:{id:r.stockLot.id,materialId:r.stockLot.materialId,lotCode:r.stockLot.lotCode,
   status:r.stockLot.status,qty:r.stockLot.qty,receiptLineId:r.stockLot.receiptLineId,
   expiresAt:r.stockLot.expiresAt,receivedAt:r.stockLot.receivedAt},
  // An empty collection is intentional: never reveal credits or amounts to these roles.
  creditAllocations:[]
 }))})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req,"quality");if(denied)return denied
 const actor=currentActor(req)!.username
 const parsed=S.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Retour invalide"},{status:400})
 const d=parsed.data
 try{
  const result=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   const lot=await tx.stockLot.findUnique({where:{id:d.stockLotId},include:{material:{select:{unit:true}}}})
   if(!lot||!lot.supplierId||!["quarantine","available"].includes(lot.status))throw new Error("LOT_NOT_RETURNABLE")
   if(!isValidPurchaseQuantity(d.qty,lot.material.unit))throw new Error("INVALID_UNIT_QTY")
   // V18.9.1 (contre-audit A-02) : un lot facturé ne peut sortir qu'avec une
   // couverture financière : un avoir FOURNISSEUR APPROUVÉ suffisant pour
   // couvrir la valeur de la quantité retournée (au prix facturé).
   // V18.9.2 (contre-audit F02/F04/F05) : trois évolutions —
   //   • la couverture s'applique AUSSI aux lots partis en quarantaine après
   //     facturation (le rejet qualité n'est plus un contournement du contrôle
   //     financier : l'isolation physique est libre, la sortie définitive non) ;
   //   • un avoir post-règlement (kind="refund", F02) compte dans la
   //     couverture au même titre qu'un avoir de solde ;
   //   • la consommation est PARTIELLE et traçable : chaque retour n'épuise
   //     un avoir qu'à hauteur de ce qu'il couvre (SupplierReturnCredit-
   //     Allocation, F05) — un avoir de 100 MAD couvrant un retour de 20 MAD
   //     conserve 80 MAD mobilisables.
   let allocationPlan:CreditAllocationPlanEntry[]=[]
   if(lot.receiptLineId&&["available","quarantine"].includes(lot.status)){
    const invoicedLines=await tx.supplierInvoiceLine.findMany({where:{receiptLineId:lot.receiptLineId,invoice:{status:{in:["matched","approved","paid"]}}},include:{invoice:{include:{credits:{include:{allocations:{select:{amountCents:true}}}}}}}})
    if(invoicedLines.length){
     // P5.15.21 (VAL-002) : valorisation CHRONOLOGIQUE — chaque tranche
     // retournée est valorisée au prix de la facture qui l'a réellement
     // couverte (ordre des factures par date), et non plus au prix de la
     // première ligne trouvée (arbitraire dès qu'un BR est facturé en
     // plusieurs fois à des prix différents).
     const returnCents=invoicedCentsForQty(invoicedLines,d.qty)
     const pool=invoicedLines.flatMap(l=>l.invoice.credits)
     const {plan,coveredCents}=planCreditAllocation(pool,returnCents)
     if(coveredCents<returnCents)throw new Error("CREDIT_NOTE_REQUIRED")
     allocationPlan=plan
    }
   }
   if(lot.status==="available")await assertStockUnreserved(tx,lot.id,lot.qty,d.qty)
   const updated=await tx.stockLot.updateMany({where:{id:lot.id,qty:{gte:d.qty}},data:{qty:{decrement:d.qty}}})
   if(updated.count!==1)throw new Error("INSUFFICIENT_STOCK")
   // V18.9.1 (contre-audit A-04) : le lot « retourné » conserve ses dates
   // d'origine (réception / péremption) pour la traçabilité.
   const returnedLot=await tx.stockLot.upsert({where:{materialId_lotCode_status_provenanceKey:{materialId:lot.materialId,lotCode:lot.lotCode,status:"returned",provenanceKey:lot.provenanceKey}},create:{materialId:lot.materialId,lotCode:lot.lotCode,status:"returned",qty:d.qty,supplierId:lot.supplierId,receiptLineId:lot.receiptLineId,provenanceKey:lot.provenanceKey,receivedAt:lot.receivedAt,expiresAt:lot.expiresAt},update:{qty:{increment:d.qty}}})
   await movePlacement(tx,lot.id,returnedLot.id,d.qty)
   if(lot.status==="available"){
    if(!lot.receiptLineId)throw new Error("MISSING_RECEIPT_PROVENANCE")
    const receipt=await tx.goodsReceiptLine.findUnique({where:{id:lot.receiptLineId},include:{supplierOrderLine:true}})
    if(!receipt)throw new Error("MISSING_RECEIPT_PROVENANCE")
    const supplierLine=receipt.supplierOrderLine
    const alreadyReturned=receipt.returnedQty
    const physicalNet=receipt.acceptedQty-alreadyReturned
    if(physicalNet+0.000001<d.qty)throw new Error("RECEIPT_RETURN_EXCEEDED")
    const rect=await tx.goodsReceiptLine.updateMany({where:{id:receipt.id,returnedQty:{lte:receipt.acceptedQty-d.qty+0.000001}},data:{returnedQty:{increment:d.qty}}})
    if(rect.count!==1)throw new Error("RECEIPT_RETURN_EXCEEDED")
    const bc=await tx.supplierOrderLine.updateMany({where:{id:supplierLine.id,receivedQty:{gte:d.qty}},data:{receivedQty:{decrement:d.qty}}})
    if(bc.count!==1)throw new Error("BC_RETURN_EXCEEDED")
    if(supplierLine.requestLineId){
     const da=await tx.purchaseRequestLine.updateMany({where:{id:supplierLine.requestLineId,receivedQty:{gte:d.qty}},data:{receivedQty:{decrement:d.qty}}})
     if(da.count!==1)throw new Error("DA_RETURN_EXCEEDED")
     const line=await tx.purchaseRequestLine.findUniqueOrThrow({where:{id:supplierLine.requestLineId}})
     await tx.purchaseRequest.updateMany({where:{id:line.requestId,status:{not:"closed"}},data:{status:"partial"}})
    }
    await tx.supplierOrder.updateMany({where:{id:supplierLine.orderId,status:{not:"closed"}},data:{status:"partial"}})
    const mat=await tx.material.updateMany({where:{id:lot.materialId,stockQty:{gte:d.qty}},data:{stockQty:{decrement:d.qty}}})
    if(mat.count!==1)throw new Error("INSUFFICIENT_STOCK")
    await tx.movement.create({data:{ref:await nextRef("MVT","movement",tx),type:"out",materialId:lot.materialId,stockLotId:lot.id,qty:d.qty,signedQty:-d.qty,unit:lot.material.unit,reason:`Retour fournisseur : ${d.reason}`,operator:actor}})
   }
   const ref=await nextRef("RF","supplierReturn",tx)
   const returned=await tx.supplierReturn.create({data:{ref,supplierId:lot.supplierId,stockLotId:lot.id,qty:d.qty,reason:d.reason,actor,creditExpected:d.creditExpected}})
   // V18.9.2 (contre-audit F05) : affectations atomiques et PARTIELLES, en
   // centimes. La garde version par avoir (lue avant planification) empêche
   // deux écritures concurrentes d'affecter le même reste ; la clé unique
   // (returnId,creditId) interdit le double affecté sur un même retour.
   // returnId sur l'avoir n'est qu'une TRACE (premier retour lié) : il ne
   // conditionne plus la disponibilité — seul le total des affectations
   // épuise un avoir.
   for(const a of allocationPlan){
    const guarded=await tx.supplierCreditNote.updateMany({where:{id:a.creditId,status:"approved",version:a.version},data:{version:{increment:1},...(a.returnId==null?{returnId:returned.id}:{})}})
    if(guarded.count!==1)throw new Error("CREDIT_NOTE_REQUIRED")
    await tx.supplierReturnCreditAllocation.create({data:{returnId:returned.id,creditId:a.creditId,amountCents:a.amountCents}})
   }
   await tx.auditEvent.create({data:{actor,action:"SUPPLIER_RETURN",entity:"SupplierReturn",entityId:String(returned.id),details:JSON.stringify({lotId:lot.id,qty:d.qty,creditAllocations:allocationPlan.map(a=>({creditId:a.creditId,amountCents:a.amountCents}))})}})
   return {ref,id:returned.id,creditNotesConsumed:allocationPlan.length,creditAllocations:allocationPlan.map(a=>({creditId:a.creditId,amountCents:a.amountCents})),allocatedCents:allocationPlan.reduce((s,a)=>s+a.amountCents,0)}
  }));
  // The return itself is operational. Credit IDs and MAD amounts must never
  // be serialized to a quality-only user after the financial coverage check.
  return NextResponse.json(canSeeMaterialCosts(req)
   ? result
   : {...result,creditAllocations:[],allocatedCents:null},{status:201})
 }catch(e){return p2pConflictResponse(e,RETURN_ERRORS,"Retour fournisseur")}
}

const RETURN_ERRORS: Record<string,string> = {
 INVALID_UNIT_QTY:"Quantité de retour incompatible avec l’unité de stock",
 LOT_NOT_RETURNABLE:"Lot inexistant, sans fournisseur ou non retournable",
 CREDIT_NOTE_REQUIRED:"Lot facturé : faire approuver par le service finances un avoir suffisant (de solde, ou post-règlement si la facture est déjà entièrement payée) avant le retour ; l'avoir n'est consommé qu'à hauteur de la valeur retournée",
 INSUFFICIENT_STOCK:"Quantité à retourner supérieure au stock du lot",
 MISSING_RECEIPT_PROVENANCE:"Provenance de la réception introuvable",
 RECEIPT_RETURN_EXCEEDED:"Quantité retournée supérieure au net accepté du BR",
 BC_RETURN_EXCEEDED:"Quantité retournée supérieure au reçu du BC",
 DA_RETURN_EXCEEDED:"Quantité retournée supérieure au reçu de la DA",
}
