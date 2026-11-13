import { NextRequest, NextResponse } from "next/server"
import { readRoleGate } from "@/lib/access-gate"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * État DA exhaustif par matière, sans montant ni identité nominative.
 * Les deux requêtes groupées évitent le plafond de 100 DA de l'écran historique
 * et ne chargent pas les lignes individuelles en mémoire.
 * Une DA « en cours » suit exactement les statuts du garde anti-doublon POST /purchases.
 */
export async function GET(req: NextRequest) {
  const denied = readRoleGate(req, ["buyer", "approver"])
  if (denied) return denied

  // R6 : filtrer sur la page de matières + lignes sélectionnées, pour éviter
  // une réponse et un groupBy sur toute la base lorsque 100 000 DA existent.
  const idsRaw=req.nextUrl.searchParams.get("ids")
  const ids=idsRaw===null?null:idsRaw.split(",").filter(Boolean).map(Number)
  if(ids!==null && (ids.length>200 || ids.some(id=>!Number.isSafeInteger(id)||id<=0)))
    return NextResponse.json({error:"Identifiants matières invalides"},{status:400})
  const materialWhere=ids===null?{}:{materialId:{in:ids}}
  const [history, active] = await Promise.all([
    db.purchaseRequestLine.groupBy({
      by: ["materialId"],where:materialWhere,
      _count: { _all: true },
    }),
    db.purchaseRequestLine.groupBy({
      by: ["materialId"],
      where: { ...materialWhere, request: { status: { in: ["pending", "approved", "partially_approved", "ordered", "partial"] } } },
      _count: { _all: true },
    }),
  ])
  const byMaterial: Record<number, { historyCount: number; activeCount: number }> = {}
  for (const record of history) byMaterial[record.materialId] = { historyCount: record._count._all, activeCount: 0 }
  for (const record of active) {
    const row = byMaterial[record.materialId] ?? { historyCount: 0, activeCount: 0 }
    row.activeCount = record._count._all
    byMaterial[record.materialId] = row
  }
  return NextResponse.json({ byMaterial }, { headers: { "Cache-Control": "no-store" } })
}
