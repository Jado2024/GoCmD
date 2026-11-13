import { safeErrorMetadata } from "@/lib/safe-server-error"
import { accessGate, currentActor, canSeeMaterialCosts } from "@/lib/access-gate"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { presentPurchase } from "@/lib/purchase-response"
import { evaluateLineDecisions } from "@/lib/purchase-line-decision"

export const dynamic = "force-dynamic"

const ActionSchema = z.object({
  action: z.enum(["advance", "decide-lines", "close", "cancel"]),
  decisions: z.array(z.object({lineId:z.number().int().positive(),decision:z.enum(["approve","reduce","reject"]),approvedQty:z.number().finite().min(0).optional(),reason:z.string().trim().max(500).optional()})).min(1).max(100).optional(),
  operator: z.string().trim().min(2).max(60).optional(),
  reason: z.string().trim().max(500).optional(),
})

/**
 * Chaque transition et, à la réception, TOUS les mouvements et mises à jour
 * de stock sont atomiques. Deux clics ne peuvent réceptionner deux fois.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = accessGate(req,"approver")
  if (denied) return denied

  const actor=currentActor(req)!.username
  const { id } = await ctx.params
  const pid = Number(id)
  if (!Number.isSafeInteger(pid) || pid <= 0) return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 })
  const parsed = ActionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Action ou opérateur invalide" }, { status: 400 })

  try {
    const result = await serializedSQLiteWrite(() => db.$transaction(async (tx) => {
      const request = await tx.purchaseRequest.findUnique({
        where: { id: pid },
        include: { lines: { include: { material: true } } },
      })
      if (!request) throw new Error("UNKNOWN_REQUEST")
      if(parsed.data.action === "cancel") {
        // Annulation d'une DA avant toute commande : seule issue pour une DA
        // erronée, sinon elle bloque indéfiniment le réapprovisionnement.
        if(!["pending","approved","partially_approved","rejected"].includes(request.status)) throw new Error("NOT_CANCELLABLE")
        if(!parsed.data.reason || parsed.data.reason.length<10) throw new Error("MISSING_CLOSE_REASON")
        const linkedBc=await tx.supplierOrderLine.count({where:{requestLine:{requestId:pid}}})
        if(linkedBc>0) throw new Error("LINKED_BC")
        if(request.status!=="pending" && request.createdBy && request.createdBy===actor) throw new Error("SELF_CANCEL_APPROVED")
        const changed=await tx.purchaseRequest.updateMany({where:{id:pid,status:request.status},data:{status:"cancelled",closedReason:parsed.data.reason,closedBy:actor,closedAt:new Date()}})
        if(changed.count!==1) throw new Error("CONCURRENT_UPDATE")
        await tx.auditEvent.create({data:{actor,action:"PURCHASE_REQUEST_CANCELLED",entity:"PurchaseRequest",entityId:String(pid),details:parsed.data.reason}})
        const cancelled=await tx.purchaseRequest.findUniqueOrThrow({where:{id:pid},include:{lines:{include:{material:true}}}})
        return {purchase:{...cancelled, expectedDate:cancelled.expectedDate?.toISOString()??null,createdAt:cancelled.createdAt.toISOString(),total:cancelled.lines.reduce((t,l)=>t+l.qty*(l.unitPrice??l.material.unitPrice),0)},received:null}
      }
      if(parsed.data.action === "close") {
        if(!["ordered", "partial"].includes(request.status)) throw new Error("NOT_CLOSABLE")
        if(!parsed.data.reason || parsed.data.reason.length<10) throw new Error("MISSING_CLOSE_REASON")
        const openBc=await tx.supplierOrderLine.count({where:{requestLine:{requestId:pid},order:{status:{in:["draft","confirmed","partial"]}}}})
        if(openBc>0)throw new Error("OPEN_BC")
        const changed=await tx.purchaseRequest.updateMany({where:{id:pid,status:request.status},data:{status:"closed",closedReason:parsed.data.reason,closedBy:actor,closedAt:new Date()}})
        if(changed.count!==1) throw new Error("CONCURRENT_UPDATE")
        await tx.auditEvent.create({data:{actor,action:"PURCHASE_REQUEST_CLOSED",entity:"PurchaseRequest",entityId:String(pid),details:parsed.data.reason}})
        const closed=await tx.purchaseRequest.findUniqueOrThrow({where:{id:pid},include:{lines:{include:{material:true}}}})
        return {purchase:{...closed, expectedDate:closed.expectedDate?.toISOString()??null,createdAt:closed.createdAt.toISOString(),total:closed.lines.reduce((t,l)=>t+l.qty*(l.unitPrice??l.material.unitPrice),0)},received:null}
      }
      // Validation ligne par ligne: écriture des décisions ET audit dans la même transaction.
      // Une DA n'entre jamais en stock par ce point d'entrée.
      if(request.status!=="pending") throw new Error("ALREADY_RECEIVED")
      if(request.createdBy && request.createdBy===actor)throw new Error("SELF_APPROVAL")
      const inputs=parsed.data.action==="advance"
        ? request.lines.map(l=>({lineId:l.id,decision:"approve" as const}))
        : parsed.data.decisions;
      if(!inputs)throw new Error("DECISIONS_INCOMPLETE");
      const verdict=evaluateLineDecisions(request.lines.map(l=>({id:l.id,qty:l.qty,unit:l.material.unit})),inputs);
      const now=new Date();
      const changed = await tx.purchaseRequest.updateMany({
        where: { id: pid, status: "pending" },
        data: { status:verdict.status, approvedBy:actor, approvedAt:now },
      });
      if (changed.count !== 1) throw new Error("CONCURRENT_UPDATE");
      for(const decision of verdict.decisions){
        const line=await tx.purchaseRequestLine.updateMany({where:{id:decision.lineId,requestId:pid,approvalDecision:'pending'},data:{
          approvedQty:decision.approvedQty,approvalDecision:decision.decision,approvalReason:decision.reason,decisionBy:actor,decisionAt:now
        }});
        if(line.count!==1)throw new Error('CONCURRENT_UPDATE');
        await tx.auditEvent.create({data:{actor,action:"PURCHASE_LINE_DECIDED",entity:"PurchaseRequestLine",entityId:String(decision.lineId),
          details:JSON.stringify({requestId:pid,ref:request.ref,requestedQty:decision.requestedQty,approvedQty:decision.approvedQty,decision:decision.decision,reason:decision.reason})}});
      }
      await tx.auditEvent.create({data:{actor,action:"PURCHASE_REQUEST_DECIDED",entity:"PurchaseRequest",entityId:String(pid),
        details:JSON.stringify({ref:request.ref,status:verdict.status,decisions:verdict.decisions.length})}});

      const updated = await tx.purchaseRequest.findUniqueOrThrow({
        where: { id: pid }, include: { lines: { include: { material: true } } },
      })
      return { purchase: {
        ...updated,
        expectedDate: updated.expectedDate?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        total: updated.lines.reduce((t, l) => t + l.qty * (l.unitPrice ?? l.material.unitPrice), 0),
      }, received: null }
    }))
    return NextResponse.json({ ...result, purchase: presentPurchase(result.purchase, canSeeMaterialCosts(req)) })
  } catch (err) {
    if (err instanceof Error && err.message === "UNKNOWN_REQUEST") return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
    if (err instanceof Error && ["ALREADY_RECEIVED", "CONCURRENT_UPDATE", "NOT_CLOSABLE", "MISSING_CLOSE_REASON", "OPEN_BC","SELF_APPROVAL","NOT_CANCELLABLE","LINKED_BC","SELF_CANCEL_APPROVED","DECISIONS_INCOMPLETE","QTE_APPROUVEE_INVALIDE","QTE_UNITE_INVALIDE","MOTIF_OBLIGATOIRE"].includes(err.message)) {
      const messages:Record<string,string>={ALREADY_RECEIVED:"Réception directe interdite : saisissez un BL avec les quantités réellement reçues",CONCURRENT_UPDATE:"DA modifiée par un autre utilisateur. Actualisez.",NOT_CLOSABLE:"Seules les DA commandées ou partiellement réceptionnées peuvent être clôturées",MISSING_CLOSE_REASON:"Motif (10 caractères minimum) obligatoire : l'auteur de la décision est le compte connecté",OPEN_BC:"Clôturez les BC encore ouverts avant de clôturer cette DA",SELF_APPROVAL:"Le demandeur ne peut pas valider sa propre DA",NOT_CANCELLABLE:"Seules les DA à valider ou validées non commandées peuvent être annulées",LINKED_BC:"Des lignes de cette DA sont déjà rattachées à un BC : clôturez le BC puis le solde de la DA",SELF_CANCEL_APPROVED:"Une DA validée doit être annulée par un autre responsable que son demandeur",DECISIONS_INCOMPLETE:"Chaque ligne doit recevoir exactement une décision",QTE_APPROUVEE_INVALIDE:"La quantité autorisée doit être comprise entre zéro et la quantité demandée ; une hausse exige une nouvelle DA",QTE_UNITE_INVALIDE:"Quantité incompatible avec l’unité de la matière",MOTIF_OBLIGATOIRE:"Pour réduire ou refuser, saisir un motif précis (10 caractères minimum)"}
      return NextResponse.json({error:messages[err.message]}, {status:409})
    }
    console.error("Échec transition demande d'achat",safeErrorMetadata(err))
    return NextResponse.json({ error: "Transition impossible, aucune modification partielle enregistrée" }, { status: 409 })
  }
}
