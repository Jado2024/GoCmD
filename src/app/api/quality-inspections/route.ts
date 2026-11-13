import {assertStockUnreserved} from "@/lib/sales-stock-reservation"
import { movePlacement } from "@/lib/p2p-placements"
import { receivedWeightedAverageCost } from "@/lib/stock-cost"
import { p2pConflictResponse } from "@/lib/p2p-api-errors"
import { accessGate,currentActor,canSeeMaterialCosts } from "@/lib/access-gate"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { db } from "@/lib/db"
import { approvedCoverageCents } from "@/lib/supplier-credit-coverage"
import { invoicedCentsForQty } from "@/lib/invoiced-valuation"
import { NextRequest,NextResponse } from "next/server"
import { z } from "zod"
import { nextRef } from "@/lib/erp-server"
import { isValidPurchaseQuantity } from "@/lib/purchase-quantity"
const S=z.object({stockLotId:z.number().int().positive(),qty:z.number().finite().positive(),decision:z.enum(["release","reject"]),reason:z.string().trim().min(10).max(300)})
export async function POST(req:NextRequest){
 const denied=accessGate(req,"quality");if(denied)return denied
 const actor=currentActor(req)!.username
 const parsed=S.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Décision qualité invalide"},{status:400})
 const d=parsed.data
 try{
  const result=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   const from=await tx.stockLot.findUnique({where:{id:d.stockLotId}})
   if(!from)throw new Error("NOT_FOUND")
   // P5.15.26 : les lots MTS ont leur propre registre de reception.
   // Un visa via le circuit fournisseurs laisserait la DPR sans preuve qualité.
   if(from.provenanceKey.startsWith('MTS-'))throw new Error('USE_MTS_QUALITY')
   const material=await tx.material.findUnique({where:{id:from.materialId},select:{unit:true}})
   if(!material)throw new Error("NOT_FOUND")
   // Même règle d'unité que les DA, BR et retours (bloc indivisible ; kg/ml au millième).
   // Contrôle AVANT toute mutation du lot, des emplacements ou des mouvements.
   if(!isValidPurchaseQuantity(d.qty,material.unit))throw new Error("QTE_UNITE_INVALIDE")
   // V18.9.2 (contre-audit F04) : la NON-CONFORMITÉ détectée sur un lot déjà
   // facturé suit la chaîne formalisée — détection → quarantaine CONSERVATOIRE
   // (isolation physique, jamais bloquée par la facturation) → avoir ou
   // remboursement (correction financière, approbation quatre-yeux) → retour
   // ou destruction. L'ancien blocage inconditionnel INVOICED_LOT rendait le
   // rejet impossible MÊME après validation financière ; la correction
   // financière est désormais portée par le retour (couverture par avoir
   // affecté) et signalée ici : la réponse indique la valeur facturée isolée
   // et la couverture d'avoirs déjà approuvés et non affectés.
   let financialCorrection:{required:true,invoicedCents:number,creditCoverageCents:number}|null=null
   if(d.decision==="reject" && from.receiptLineId){
    const invoicedLines=await tx.supplierInvoiceLine.findMany({where:{receiptLineId:from.receiptLineId,invoice:{status:{in:["matched","approved","paid"]}}},include:{invoice:{include:{credits:{include:{allocations:{select:{amountCents:true}}}}}}}})
    if(invoicedLines.length){
     // AUDIT P5.15.27-A (FORM-08) : valorisation chronologique par tranche
     // facturée (même règle que les retours fournisseurs, VAL-002) au lieu du
     // prix de la première facture trouvée — BR facturé en plusieurs fois.
     financialCorrection={required:true,invoicedCents:invoicedCentsForQty(invoicedLines,d.qty),creditCoverageCents:approvedCoverageCents(invoicedLines.flatMap(l=>l.invoice.credits))}
    }
   }
   const isLegacy=from.status==="legacy_unverified"
   // A migrated baseline is NOT quality-validated until every occupied location
   // has an independently approved physical count matching its CURRENT quantity.
   if(isLegacy && d.decision==="release"){
     const locations=await tx.stockPlacement.findMany({where:{stockLotId:from.id,qty:{gt:0}}})
     if(!locations.length)throw new Error("LEGACY_NOT_COUNTED")
     const approved=await tx.stockCount.findMany({where:{lotId:from.id,status:"approved"},orderBy:{countedAt:"desc"}})
     for(const place of locations){
       const count=approved.find(c=>c.locationId===place.locationId&&c.countedBy!==c.approvedBy)
       if(!count||Math.abs(count.observedQty-place.qty)>1e-6)throw new Error("LEGACY_NOT_COUNTED")
     }
   }
   const srcStatus=d.decision==="release"?(isLegacy?"legacy_unverified":"quarantine"):"available"
   if(from.status!==srcStatus)throw new Error("BAD_STATUS")
   const dstStatus=d.decision==="release"?"available":"quarantine"
   if(d.decision==="reject")await assertStockUnreserved(tx,from.id,from.qty,d.qty)
   const changed=await tx.stockLot.updateMany({where:{id:from.id,status:srcStatus,qty:{gte:d.qty}},data:{qty:{decrement:d.qty}}})
   if(changed.count!==1)throw new Error("INSUFFICIENT_STOCK")
   // V18.9.1 (contre-audit A-04) : les dates d'origine (réception/péremption)
   // sont recopiées sur le lot destination : une libération qualité ne doit
   // ni rajeunir artificiellement le lot ni perdre la péremption (FEFO).
   const target=await tx.stockLot.upsert({where:{materialId_lotCode_status_provenanceKey:{materialId:from.materialId,lotCode:from.lotCode,status:dstStatus,provenanceKey:from.provenanceKey}},update:{qty:{increment:d.qty}},create:{materialId:from.materialId,lotCode:from.lotCode,status:dstStatus,qty:d.qty,supplierId:from.supplierId,receiptLineId:from.receiptLineId,provenanceKey:from.provenanceKey,receivedAt:from.receivedAt,expiresAt:from.expiresAt}})
   await movePlacement(tx,from.id,target.id,d.qty)
   // historical baseline is ALREADY counted in Material.stockQty: never double it
   const delta=d.decision==="release"?(isLegacy?0:d.qty):-d.qty
   if(delta>0){
    const oldMaterial=await tx.material.findUniqueOrThrow({where:{id:from.materialId}})
    let unitCost=Number(oldMaterial.averageCost??oldMaterial.unitPrice)
    if(from.receiptLineId){
     const receipt=await tx.goodsReceiptLine.findUnique({where:{id:from.receiptLineId},include:{supplierOrderLine:true}})
     if(receipt)unitCost=receipt.supplierOrderLine.unitPrice
    }
    const average=receivedWeightedAverageCost(oldMaterial.stockQty,oldMaterial.averageCost===null?null:Number(oldMaterial.averageCost),oldMaterial.unitPrice,delta,unitCost)
    await tx.material.update({where:{id:from.materialId},data:{stockQty:{increment:delta},averageCost:average}})
   }
   if(delta<0){const updated=await tx.material.updateMany({where:{id:from.materialId,stockQty:{gte:-delta}},data:{stockQty:{increment:delta}}});if(updated.count!==1)throw new Error("INSUFFICIENT_STOCK")}
   if(delta!==0){
    const ref=await nextRef("MVT","movement",tx)
    await tx.movement.create({data:{ref,materialId:from.materialId,stockLotId:target.id,type:"adjust",qty:d.qty,signedQty:delta,unit:material.unit,reason:`Décision qualité : ${d.reason}`,operator:actor}})
   }
   // If initially rejected on supplier delivery, release also increases accepted BC/DA qty.
   if(d.decision==="release"&&!isLegacy&&from.receiptLineId){
    const rl=await tx.goodsReceiptLine.findUnique({where:{id:from.receiptLineId},include:{supplierOrderLine:true}})
    if(rl){
     const line=rl.supplierOrderLine
     const recorded=await tx.goodsReceiptLine.updateMany({where:{id:rl.id,rejectedQty:{gte:d.qty}},data:{rejectedQty:{decrement:d.qty},acceptedQty:{increment:d.qty}}})
     if(recorded.count!==1)throw new Error("REJECTED_QTY_EXCEEDED")
     const upd=await tx.supplierOrderLine.updateMany({where:{id:line.id,receivedQty:{lte:line.qty-d.qty+0.000001}},data:{receivedQty:{increment:d.qty}}})
     if(upd.count!==1)throw new Error("BC_EXCEEDED")
     if(line.requestLineId){
      const request=await tx.purchaseRequestLine.findUniqueOrThrow({where:{id:line.requestLineId}})
      const pr=await tx.purchaseRequestLine.updateMany({where:{id:request.id,receivedQty:{lte:request.approvedQty-d.qty+0.000001}},data:{receivedQty:{increment:d.qty}}})
      if(pr.count!==1)throw new Error("DA_EXCEEDED")
     }
     const bclines=await tx.supplierOrderLine.findMany({where:{orderId:line.orderId}})
     // Un BC clôturé ne doit jamais être ressuscité par une libération qualité :
     // les quantités sont mises à jour, le statut « closed » et son motif restent intacts.
     await tx.supplierOrder.updateMany({where:{id:line.orderId,status:{not:"closed"}},data:{status:bclines.every(l=>l.receivedQty>=l.qty-0.000001)?"received":"partial"}})
     if(line.requestLineId){
      const rr=await tx.purchaseRequestLine.findUniqueOrThrow({where:{id:line.requestLineId}})
      const reqLines=await tx.purchaseRequestLine.findMany({where:{requestId:rr.requestId}})
      await tx.purchaseRequest.updateMany({where:{id:rr.requestId,status:{notIn:["closed","received"]}},data:{status:reqLines.every(x=>x.receivedQty>=x.approvedQty-0.000001)?"received":"partial"}})
     }
    }
   }
   if(d.decision==="reject"&&from.receiptLineId){
    const rl=await tx.goodsReceiptLine.findUnique({where:{id:from.receiptLineId},include:{supplierOrderLine:true}})
    if(!rl)throw new Error("MISSING_RECEIPT_PROVENANCE")
    const line=rl.supplierOrderLine
    const updated=await tx.goodsReceiptLine.updateMany({where:{id:rl.id,acceptedQty:{gte:d.qty}},data:{acceptedQty:{decrement:d.qty},rejectedQty:{increment:d.qty}}})
    if(updated.count!==1)throw new Error("ACCEPTED_QTY_EXCEEDED")
    const bc=await tx.supplierOrderLine.updateMany({where:{id:line.id,receivedQty:{gte:d.qty}},data:{receivedQty:{decrement:d.qty}}})
    if(bc.count!==1)throw new Error("BC_QTY_INCONSISTENT")
    if(line.requestLineId){
     const da=await tx.purchaseRequestLine.updateMany({where:{id:line.requestLineId,receivedQty:{gte:d.qty}},data:{receivedQty:{decrement:d.qty}}})
     if(da.count!==1)throw new Error("DA_QTY_INCONSISTENT")
     const request=await tx.purchaseRequestLine.findUniqueOrThrow({where:{id:line.requestLineId}})
     await tx.purchaseRequest.updateMany({where:{id:request.requestId,status:{not:"closed"}},data:{status:"partial"}})
    }
    await tx.supplierOrder.updateMany({where:{id:line.orderId,status:{not:"closed"}},data:{status:"partial"}})
   }
   const inspection=await tx.qualityInspection.create({data:{materialId:from.materialId,stockLotId:from.id,decision:d.decision,qty:d.qty,actor,reason:d.reason}})
   await tx.auditEvent.create({data:{actor,action:`QUALITY_${d.decision.toUpperCase()}`,entity:"StockLot",entityId:String(from.id),details:JSON.stringify({inspectionId:inspection.id,qty:d.qty,reason:d.reason,financialCorrection})}})
   return {id:inspection.id,stockLotId:target.id,status:dstStatus,qty:d.qty,financialCorrection}
  }));
  // The quality officer needs to know that a financial correction is required,
  // never the supplier's invoice or credit amounts. The full figures remain in
  // the finance-controlled records and internal audit event, not this response.
  const visibleCorrection = canSeeMaterialCosts(req)
    ? result.financialCorrection
    : result.financialCorrection ? {required:true} : null
  return NextResponse.json({...result,financialCorrection:visibleCorrection},{status:201})
 }catch(e){return p2pConflictResponse(e,QUALITY_ERRORS,"contrôle qualité")}
}

const QUALITY_ERRORS: Record<string,string> = {
 NOT_FOUND:"Lot introuvable",
 QTE_UNITE_INVALIDE:"Quantité incompatible avec l’unité : bloc entier, 3 décimales au plus pour kg/ml/m",
 LEGACY_NOT_COUNTED:"Stock historique : comptage physique indépendant approuvé requis pour chaque emplacement",
 BAD_STATUS:"Décision incompatible avec le statut actuel du lot",
 INSUFFICIENT_STOCK:"Quantité insuffisante dans le lot",
 REJECTED_QTY_EXCEEDED:"Quantité libérée supérieure au stock rejeté du BR",
 ACCEPTED_QTY_EXCEEDED:"Quantité rejetée supérieure au stock accepté du BR",
 BC_EXCEEDED:"Quantité supérieure au solde du bon de commande",
 DA_EXCEEDED:"Quantité supérieure au besoin de la demande d'achat",
 BC_QTY_INCONSISTENT:"Solde reçu du bon de commande insuffisant",
 DA_QTY_INCONSISTENT:"Solde reçu de la demande d'achat insuffisant",
 MISSING_RECEIPT_PROVENANCE:"Traçabilité du bon de réception introuvable",
}
