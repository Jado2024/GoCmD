import { replenishmentPosition, type MaterialSupply } from './material-replenishment.ts'

/**
 * Tri opérationnel des matières (GoCmd, sans calcul de besoin GoProd).
 * Les ruptures passent avant les stocks sous seuil, puis les stocks suffisants.
 * À niveau de risque égal, les articles sans DA active sont proposés en premier.
 * Une DA/BC en cours ne signifie PAS que le besoin est couvert : indicateur informatif.
 */
export type MaterialSortMode = "urgency" | "name" | "stock" | "gap" | "category"
export type MaterialDaFilter = "all" | "without-active" | "with-active" | "history" | "without-history"
export type MaterialStockFilter = "all" | "out" | "low" | "ok"
export type MaterialDaPresence = { historyCount: number; activeCount: number }
export type MaterialSortEntry = { id: number; ref: string; name: string; category: string;
  stockQty: number; minStock: number; supplierNames?: string[]; supplier?: string | null }

export function materialRiskBand(m: MaterialSortEntry): 0 | 1 | 2 {
  return m.stockQty <= 0 ? 0 : m.stockQty < m.minStock ? 1 : 2
}
export function materialStockGap(m: MaterialSortEntry): number {
  return Math.max(0, m.minStock - m.stockQty)
}
export function materialHasActiveDa(p: MaterialDaPresence | undefined): boolean {
  return Boolean(p && p.activeCount > 0)
}
export function filterAndSortMaterials<T extends MaterialSortEntry>(
  materials: readonly T[], options: {
    sort: MaterialSortMode;
    stock: MaterialStockFilter;
    da: MaterialDaFilter;
    supplier: string;
    supply?: Readonly<Record<number, MaterialSupply>>;
    presence?: Readonly<Record<number, MaterialDaPresence>>;
  },
): T[] {
  // Ne jamais montrer « sans DA » si le serveur ne sait pas répondre.
  if (options.da !== "all" && !options.presence) return []
  const entries = materials.filter(m => {
    const risk = materialRiskBand(m)
    if (options.stock === "out" && risk !== 0) return false
    if (options.stock === "low" && risk !== 1) return false
    if (options.stock === "ok" && risk !== 2) return false
    if (options.supplier !== "all" && !(
      (m.supplierNames ?? []).includes(options.supplier) || m.supplier === options.supplier
    )) return false
    if (options.da !== "all") {
      const p = options.presence?.[m.id]
      if (options.da === "with-active" && !materialHasActiveDa(p)) return false
      if (options.da === "without-active" && materialHasActiveDa(p)) return false
      if (options.da === "history" && !(p && p.historyCount > 0)) return false
      if (options.da === "without-history" && p && p.historyCount > 0) return false
    }
    return true
  })
  const byName = (a:T,b:T) => a.name.localeCompare(b.name, "fr", {sensitivity:"base"}) || a.ref.localeCompare(b.ref,"fr") || a.id-b.id
  const rank = (m: T) => {
    const p = replenishmentPosition(m, options.supply?.[m.id])
    if (p.freeQty <= 0 && p.datedQty <= 0) return 0
    if (p.freeQty <= 0 && p.remainingGap > 0) return 1
    if (p.freeQty < m.minStock && p.remainingGap > 0) return 2
    if (p.freeQty <= 0) return 3
    if (p.freeQty < m.minStock) return 4
    return 5
  }
  return entries.sort((a,b) => {
    if (options.sort === "name") return byName(a,b)
    if (options.sort === "category") return a.category.localeCompare(b.category,"fr") || byName(a,b)
    if (options.sort === "stock") return a.stockQty - b.stockQty || byName(a,b)
    if (options.sort === "gap") return materialStockGap(b)-materialStockGap(a) || byName(a,b)
    if (options.supply) {
      const priority = rank(a) - rank(b)
      if (priority) return priority
    }
    const aRisk=materialRiskBand(a), bRisk=materialRiskBand(b)
    if (aRisk!==bRisk) return aRisk-bRisk
    if (options.presence) {
      const aActive=Number(materialHasActiveDa(options.presence[a.id]))
      const bActive=Number(materialHasActiveDa(options.presence[b.id]))
      if (aActive!==bActive) return aActive-bActive
    }
    return materialStockGap(b)-materialStockGap(a) || a.stockQty-b.stockQty || byName(a,b)
  })
}
