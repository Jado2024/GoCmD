import { db } from "@/lib/db"

// ─────────────────────────────────────────────────────────────
// Helpers serveur partagés par les routes API
// (pas de nomenclature/BOM : les prix sont saisis à la commande)
// ─────────────────────────────────────────────────────────────

export const ORDER_FLOW = ["new", "production", "ready", "shipped"] as const
export const PURCHASE_FLOW = ["pending", "approved", "ordered", "partial", "received"] as const

export function nextOrderStatus(s: string): string | null {
  const i = ORDER_FLOW.indexOf(s as (typeof ORDER_FLOW)[number])
  if (i < 0 || i === ORDER_FLOW.length - 1) return null
  return ORDER_FLOW[i + 1]
}

export function nextPurchaseStatus(s: string): string | null {
  const i = PURCHASE_FLOW.indexOf(s as (typeof PURCHASE_FLOW)[number])
  if (i < 0 || i === PURCHASE_FLOW.length - 1) return null
  return PURCHASE_FLOW[i + 1]
}

// Client Prisma minimal requis (db ou client de transaction)
type RefModel = "order" | "movement" | "purchaseRequest" | "supplierOrder" | "supplierReturn"
type RefClient = Pick<typeof db, RefModel | "$queryRawUnsafe">

/** Sequential reference based on the greatest already issued suffix. Unique constraints
 * remain mandatory. Concurrent writers must retry a failed transaction on P2002.
 * R13.3 (PERF-01) : la version précédente chargeait TOUTES les références de
 * l'année (findMany complet, coût O(N) par création — mesuré 1,2 ms SQL à
 * 2 000 commandes et croissant, EXPLAIN QUERY PLAN : SCAN Order_ref_key) ;
 * elle est remplacée par UNE agrégation SQL indexée MAX(CAST(suffixe)). Le
 * résultat est identique : même suffixe maximal, même format, la contrainte
 * d'unicité et le retry P2002 restent la garantie finale. */
export async function nextRef(prefix:string,model:RefModel,client:RefClient=db):Promise<string>{
 const year=new Date().getFullYear()
 const startsWith=`${prefix}-${year}-`
 const floor=["supplierOrder","supplierReturn"].includes(model)?0:300
 // Préfixe construit par le code (jamais une entrée utilisateur) : la requête
 // préparée reste sans interpolation applicative.
 const rows=await client.$queryRawUnsafe<{maxN:number|bigint|null}[]>(
  `SELECT MAX(CAST(SUBSTR(ref, ?) AS INTEGER)) AS maxN FROM "${MODEL_TABLE[model]}" WHERE ref LIKE ? ESCAPE '\\'`,
  String(startsWith.length+1), startsWith.replace(/[%_\\]/g,'\\$&')+'%')
 let highest=Number(rows[0]?.maxN)
 if(!Number.isSafeInteger(highest)||highest<floor)highest=floor
 return `${startsWith}${String(highest+1).padStart(["supplierOrder","supplierReturn"].includes(model)?5:4,"0")}`
}
const MODEL_TABLE: Record<RefModel,string> = {
 order: "Order", movement: "Movement", purchaseRequest: "PurchaseRequest",
 supplierOrder: "SupplierOrder", supplierReturn: "SupplierReturn",
}
