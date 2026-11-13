import { safeErrorMetadata } from "@/lib/safe-server-error"
import type {Prisma} from "@prisma/client"
import {readDocumentPage,documentPagination} from "@/lib/document-register"
import { accessGate, currentActor, readRoleGate, canSeeMaterialCosts } from "@/lib/access-gate"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { nextRef } from "@/lib/erp-server"
import {remainingToOrder} from "@/lib/purchase-availability"
import { isValidPurchaseQuantity } from "@/lib/purchase-quantity"
import { presentPurchase } from "@/lib/purchase-response"

export const dynamic = "force-dynamic"

const Schema = z.object({
  supplier: z.string().max(120).optional().nullable(),
  expectedDate: z.string().datetime().optional().nullable(),
  note: z.string().max(300).optional().nullable(),
  duplicateJustification: z.string().trim().min(10).max(500).optional(),
  lines: z
    .array(
      z.object({
        materialId: z.number().int().positive(),
        qty: z.number().finite().positive().max(1000000),
      }),
    )
    .min(1).max(100),
})

export async function GET(req: NextRequest) {
  // Moindre privilège : le rôle technique admin SEUL n'autorise pas
  // à lire les achats. Attribuer explicitement buyer ou approver si nécessaire.
  const denied = readRoleGate(req, ["buyer", "approver"])
  if (denied) return denied





  const canReadCosts = canSeeMaterialCosts(req)
  const params=req.nextUrl.searchParams
  const {page,pageSize,skip,take,q}=readDocumentPage(params,100)
  const requestedStatus=(params.get('status')??'all').trim()
  const allowedStatuses=['pending','approved','partially_approved','rejected','ordered','partial','received','closed','cancelled']
  const status=allowedStatuses.includes(requestedStatus)?requestedStatus:'all'
  const eligible=params.get('eligible')==='1'
  const category=params.get('category')??'all'
  const risk=params.get('risk')??'all'
  const materialScope:Prisma.MaterialWhereInput={
    ...(category!=='all'?{category}:{}),
    ...(risk==='out'?{stockQty:{lte:0}}:risk==='low'?{stockQty:{gt:0,lt:db.material.fields.minStock}}:{}),
  }
  const scope:Prisma.PurchaseRequestWhereInput={
    ...(q?{OR:[{ref:{contains:q}},{lines:{some:{material:{...materialScope,OR:[{ref:{contains:q}},{name:{contains:q}}]}}}}]}:{}),
    ...(eligible?{lines:{some:{approvedQty:{gt:db.purchaseRequestLine.fields.receivedQty},material:materialScope}}}:{}),
  }
  const where={...scope,...(eligible?{status:{in:['approved','partially_approved','ordered','partial']}}:status==='all'?{}:{status})}
  const [total,groups]=await Promise.all([db.purchaseRequest.count({where}),db.purchaseRequest.groupBy({where:scope,by:['status'],_count:{_all:true}})])
  const statusCounts=Object.fromEntries(groups.map(x=>[x.status,x._count._all]))
  const purchases = await db.purchaseRequest.findMany({where,
    include: { lines: { include: { material: true, supplierOrderLines:{select:{qty:true,receivedQty:true,order:{select:{status:true}}}} } }, receipts: { include: { lines: true }, orderBy: { createdAt: "desc" } } },
    orderBy: [{ createdAt: "desc" }, { id:"desc" }],
    skip,take,
  })
  return NextResponse.json({
    pagination:{...documentPagination(page,pageSize,total),status},statusCounts,
    items: purchases.map((p) => {
      const presented=presentPurchase(p,canReadCosts)
      const sourceLines=new Map(p.lines.map(line=>[line.id,line]))
      return {
      ...presented,
      // Ne pas exposer les détails internes des BC dans le DTO de DA : uniquement les agrégats.
      lines:presented.lines.map(line=>({
        ...line, supplierOrderLines:undefined,
        consultationRemainingQty:sourceLines.has(line.id)?remainingToOrder(sourceLines.get(line.id)!):0,
        orderedQty:sourceLines.get(line.id)?.supplierOrderLines.filter(x=>['confirmed','partial','received','closed'].includes(x.order.status)).reduce((s,x)=>s+x.qty,0)??0,
        openOrderRemainingQty:sourceLines.get(line.id)?.supplierOrderLines.filter(x=>['confirmed','partial'].includes(x.order.status)).reduce((s,x)=>s+Math.max(0,x.qty-x.receivedQty),0)??0,
        draftOrderQty:sourceLines.get(line.id)?.supplierOrderLines.filter(x=>x.order.status==='draft').reduce((s,x)=>s+x.qty,0)??0,
      })),
      // Historique chargé à la demande, paginé via /api/purchases/[id]/history.
      approvalHistory:[],
      expectedDate: p.expectedDate?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      }
    }),
  })
}

export async function POST(req: NextRequest) {
  const denied = accessGate(req,"buyer")
  if (denied) return denied
  const actor=currentActor(req)!.username
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Corps de requête invalide", details: parsed.error.flatten() }, { status: 400 })
  }
  const data = parsed.data

  // Regrouper les doublons de la même matière plutôt que créer des lignes ambiguës.
  const aggregated = new Map<number, number>()
  for (const line of data.lines) {
    aggregated.set(line.materialId, (aggregated.get(line.materialId) ?? 0) + line.qty)
  }
  const lines = [...aggregated.entries()].map(([materialId, qty]) => ({ materialId, qty }))
  if (lines.some(l => !Number.isFinite(l.qty) || l.qty > 1000000))
    return NextResponse.json({error:'Quantité cumulée excessive'},{status:400})
  const mats = await db.material.findMany({ where: { id: { in: lines.map((l) => l.materialId) } } })
  if (mats.length === lines.length && lines.some(l => !isValidPurchaseQuantity(l.qty, mats.find(m=>m.id===l.materialId)!.unit)))
    return NextResponse.json({error:'Quantité incompatible avec l’unité : entier pour bloc, 3 décimales maximum pour kg/ml/m.'},{status:400})
  if(mats.some(m=>!m.isPurchasable || (m.category==="Mousse"&&m.foamNature==="AGGLO")))
    return NextResponse.json({error:"Article non achetable : besoin de fabrication interne ou achat désactivé"},{status:409})
  if (mats.length !== lines.length) {
    return NextResponse.json({ error: "Matière introuvable dans la demande" }, { status: 404 })
  }

  try {
  const pr = await serializedSQLiteWrite(() => db.$transaction(async tx => {
    const previous=await tx.purchaseRequest.findMany({where:{status:{in:['pending','approved','partially_approved','ordered','partial']},lines:{some:{materialId:{in:lines.map(l=>l.materialId)}}}},include:{lines:true}})
    const duplicates=previous.flatMap(p=>p.lines.filter(l=>lines.some(row=>row.materialId===l.materialId)).map(l=>({ref:p.ref,materialId:l.materialId,qty:l.qty})))
    if(duplicates.length&&!data.duplicateJustification){
      throw Object.assign(new Error('DA_EXISTANTE'),{conflicts:duplicates})
    }
    const ref = await nextRef("DA", "purchaseRequest", tx)
    const created = await tx.purchaseRequest.create({
    data: {
      ref,
      status: "pending",
      createdBy: actor,
      supplier: data.supplier ?? null,
      expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
      note: data.note ?? null,
      lines: {
        create: lines.map((l) => {
          const m = mats.find((mm) => mm.id === l.materialId)!
          return { materialId: l.materialId, qty: l.qty, unitPrice: m.unitPrice }
        }),
      },
    },
    include: { lines: { include: { material: true } } },
  })

    await tx.auditEvent.create({data:{actor,action:"PURCHASE_REQUEST_CREATED",entity:"PurchaseRequest",entityId:String(created.id),details:JSON.stringify({ref:created.ref,duplicateJustification:data.duplicateJustification??null, priorReferences:duplicates.map(d=>d.ref)})}})
    return created
  }))
  return NextResponse.json(
    {
      purchase: {
        ...presentPurchase(pr, canSeeMaterialCosts(req)),
        expectedDate: pr.expectedDate?.toISOString() ?? null,
        createdAt: pr.createdAt.toISOString(),
      },
    },
    { status: 201 },
  )
  } catch (error) {
    if(error instanceof Error&&error.message==='DA_EXISTANTE')return NextResponse.json({error:'Une DA ouverte existe déjà pour cette matière',code:'DA_EXISTANTE',conflicts:(error as Error&{conflicts:unknown[]}).conflicts},{status:409})
    console.error("Création DA annulée (conflit transactionnel)",safeErrorMetadata(error))
    return NextResponse.json({error:"Demande non enregistrée : conflit de référence ou de transaction. Recommencez."},{status:409})
  }
}
