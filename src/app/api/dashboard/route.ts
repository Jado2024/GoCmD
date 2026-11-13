import { NextRequest } from "next/server"
import { accessGate, currentActor, canSeeMaterialCosts } from "@/lib/access-gate"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import type { DashboardDTO } from "@/lib/erp-types"

export const dynamic = "force-dynamic"

/** V18.9.1 (contre-audit A-03) : fiches clients et tarifs de vente réservés
 * aux rôles commercial / finances / admin. Les autres rôles authentifiés
 * (qualité, magasinier, acheteur, réceptionnaire…) reçoivent des KPI agrégés
 * sans coordonnées clients ni montants de commandes. */
const COMMERCIAL_ROLES = ["sales", "finance"] as const

export async function GET(req: NextRequest) {
  const denied = accessGate(req)
  if (denied) return denied

  const actor = currentActor(req)
  const canSeeCommercial = Boolean(
    actor && !actor.legacy && !(actor.managed && actor.permissions?.["clients.read"]===false) &&
      (actor.roles.some(r => (COMMERCIAL_ROLES as readonly string[]).includes(r)) || actor.roles.includes("director")),
  )
  // V18.9.8 : les agrégats valorisés ont la même confidentialité que
  // les coûts unitaires : le masquage des prix ne doit pas laisser des
  // valeurs MAD reconstructibles à partir des graphiques.
  // V18.9.2 (contre-audit F03) : les coûts matières (unitPrice, averageCost)
  // suivent la même matrice que les tarifs fournisseurs — achats, approbation,
  // finances, admin. Les alertes de stock bas sont diffusées à tous les rôles
  // authentifiés, mais via un DTO explicite : plus jamais l'objet matière
  // intégral ({...m}) avec ses coûts.
  const canSeeCosts = canSeeMaterialCosts(req)




  // R13.3 (PERF-02, OOM) : cette route chargeait TOUTES les commandes actives
  // avec lignes + produits + clients (findMany non borné). Sur une base de
  // 20 000 commandes, 10 consultations concurrentes du tableau de bord ont
  // fait monter le serveur à ~1,7 Go de RSS et le tueur OOM du noyau l'a
  // arrêté (mesuré : harnais S15, journal ECONNREFUSED + dmesg oom-kill).
  // Corrections autorisées §4 (agrégations optimisées, chargements inutiles
  // réduits, colonnes strictement nécessaires) — le DTO et le RBAC sont
  // strictement inchangés :
  //  - pipelineValue : SUM SQL (même formule qty×unitPrice, mêmes statuts) ;
  //  - activeOrders : COUNT SQL ;
  //  - upcoming : 6 premières commandes par dueDate croissant (NULL d'abord,
  //    comme le tri JS d'origine), lignes réduites à {qty, unitPrice}.
  const [materials, lateOrders, products, openPurchases, movements, unverifiedLots, unverifiedMovements, archivedLegacyMovements, demoOpeningMovements, activeOrderCount, pipelineRow, upcomingRaw] = await Promise.all([
    db.material.findMany(),
    db.order.count({
      where: { status: { in: ["new", "production"] }, dueDate: { lt: new Date() } },
    }),
    db.product.count(),
    db.purchaseRequest.count({ where: { status: { in: ["pending", "approved", "partially_approved", "ordered", "partial"] } } }),
    db.movement.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { material: true },
      where: { signedQty: { not: null }, isArchived:false,isOpeningBalance:false },
    }),
    db.stockLot.count({where:{status:"legacy_unverified"}}),
    db.movement.count({where:{signedQty:null,isArchived:false}}),
    db.movement.count({where:{isArchived:true}}),
    db.movement.count({where:{isArchived:false,isOpeningBalance:true}}),
    db.order.count({ where: { status: { in: ["new", "production", "ready"] } } }),
    db.$queryRawUnsafe<{ total: number | bigint | null }[]>(
      `SELECT COALESCE(SUM(l."qty" * l."unitPrice"), 0) AS total FROM "OrderLine" l ` +
      `INNER JOIN "Order" o ON o."id" = l."orderId" WHERE o."status" IN ('new','production','ready')`,
    ),
    db.order.findMany({
      where: { status: { in: ["new", "production", "ready"] } },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: 6,
      include: { lines: { select: { qty: true, unitPrice: true } }, client: true },
    }),
  ])
  const activeOrders = { length: activeOrderCount }

  // KPIs
  const cost = (m: typeof materials[number]) => m.averageCost != null && Number(m.averageCost) > 0 ? Number(m.averageCost) : m.unitPrice
  const stockValue = materials.reduce((s, m) => s + m.stockQty * cost(m), 0)
  const alertsList = materials.filter((m) => m.stockQty < m.minStock)
  const pipelineValue = canSeeCommercial
    ? Number(pipelineRow[0]?.total ?? 0)
    : null

  // Valeur par catégorie
  const catMap = new Map<string, number>()
  for (const m of materials) {
    catMap.set(m.category, (catMap.get(m.category) ?? 0) + m.stockQty * cost(m))
  }

  // Les données legacy non vérifiées ne doivent jamais apparaître comme une activité récente.
  // Regroupement métier Europe/London? Non : SITE SODEPI = Africa/Casablanca.
  const dayKey=(d:Date)=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Africa/Casablanca",year:"numeric",month:"2-digit",day:"2-digit"}).format(d)
  const now=new Date(), since=new Date(now.getTime()-15*86400000)
  const recent=await db.movement.findMany({where:{createdAt:{gte:since},signedQty:{not:null},isArchived:false,isOpeningBalance:false,type:{in:["in","out","adjust"]}},include:{material:true}})
  const days:DashboardDTO["flow"] = []
  const base = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),12))
  for(let i=13;i>=0;i--){
    const d=new Date(base.getTime()-i*86400000)
    days.push({day:dayKey(d),in:0,out:0})
  }
  const idx=new Map(days.map((d,i)=>[d.day,i]))
  for(const mv of recent){
    if(!mv.material||mv.signedQty==null)continue
    const i=idx.get(dayKey(mv.createdAt));if(i==null)continue
    const signed=mv.signedQty
    const val=Math.abs(signed)*cost(mv.material)
    if(signed>0) days[i].in+=val
    else if(signed<0) days[i].out+=val
  }

  // R13.3 (PERF-02) : plus de tri JS de toutes les commandes actives — les 6
  // premières par dueDate croissant viennent de la requête ciblée ci-dessus
  // (mêmes champs, même ordre NULL-d'abord que le tri historique).
  const upcoming: DashboardDTO["upcoming"] = upcomingRaw
    .map((o) => ({
      id: o.id,
      ref: o.ref,
      status: o.status as DashboardDTO["upcoming"][number]["status"],
      priority: o.priority as DashboardDTO["upcoming"][number]["priority"],
      dueDate: o.dueDate?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      note: canSeeCommercial ? o.note : null,
      // Contre-audit A-03 : ni fiche client ni montant diffusés aux rôles non commerciaux.
      client: canSeeCommercial ? o.client : null,
      total: canSeeCommercial ? o.lines.reduce((t, l) => t + l.qty * l.unitPrice, 0) : null,
    }))

  const dto: DashboardDTO = {
    baseline: { unverifiedLots,unverifiedMovements,archivedLegacyMovements,demoOpeningMovements,stockValueIsProvisional:unverifiedLots>0 },
    kpi: {
      stockValue: canSeeCosts ? stockValue : null,
      stockUnits: materials.length,
      alerts: alertsList.length,
      activeOrders: activeOrders.length,
      pipelineValue,
      lateOrders,
      products,
      openPurchases,
    },
    byCategory: canSeeCosts ? [...catMap.entries()]
      .map(([category, value]) => ({ category, value }))
      .sort((a, b) => b.value - a.value) : [],
    flow: canSeeCosts ? days : [],
    flowUnit: "MAD",
    recentMovements: movements.map((m) => ({
      id: m.id,
      ref: m.ref,
      type: m.type as DashboardDTO["recentMovements"][number]["type"],
      qty: m.qty,
      unit: m.unit,
      reason: m.reason,
      document: m.document,
      // RR-18: minimise les données nominatives des opérateurs dans les vues
      // générales. Les équipes magasin/achats/finance/contrôle conservent la trace.
      operator: actor && !actor.legacy && actor.roles.some(role=>["admin","inventory","approver","buyer","finance"].includes(role)) ? m.operator : null,
      createdAt: m.createdAt.toISOString(),
      material: m.material ? { ref: m.material.ref, name: m.material.name, category: m.material.category } : null,
    })),
    alertsList: alertsList.map(m => ({
      // V18.9.2 (contre-audit F03) : DTO explicite — l'objet matière intégral
      // (avec unitPrice et averageCost) n'est plus diffusé via {...m}.
      id: m.id,
      ref: m.ref,
      name: m.name,
      category: m.category,
      unit: m.unit,
      stockQty: m.stockQty,
      minStock: m.minStock,
      location: m.location,
      supplier: m.supplier,
      foamNature: m.foamNature === "PURE" || m.foamNature === "AGGLO" ? m.foamNature : null,
      isPurchasable:m.isPurchasable,
      isManufactured:m.isManufactured,
      foamGrade: m.foamGrade,
      foamDensity: m.foamDensity,
      unitPrice: canSeeCosts ? m.unitPrice : null,
      averageCost: canSeeCosts ? (m.averageCost == null ? null : String(m.averageCost)) : null,
    })),
    upcoming,
  }
  return NextResponse.json(dto,{headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}})
}
