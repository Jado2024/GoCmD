/** Filtres combinables de sélection des matières dans la création de DA. */
export type DaStatusFilter = "all" | "without" | "active" | "history"
export type StockStatusFilter = "all" | "out" | "low" | "ok"
export type MaterialSortFilter = "urgency" | "name" | "stock"
export type DaPresence = { historyCount: number; activeCount: number }
export type PurchaseCandidate = {
  id: number; name: string; ref: string; category: string;
  stockQty: number; minStock: number; supplier?: string | null; supplierNames?: string[];
}
export type MaterialFilterOptions = {
  da: DaStatusFilter; stock: StockStatusFilter; category: string; supplier: string; sort: MaterialSortFilter;
}
export function filterPurchaseCandidates<T extends PurchaseCandidate>(
  materials: readonly T[], byMaterial: Readonly<Record<number, DaPresence>>, options: MaterialFilterOptions,
): T[] {
  const stockRank = (m: T) => m.stockQty <= 0 ? 0 : m.stockQty < m.minStock ? 1 : 2
  return materials.filter(m => {
    const da = byMaterial[m.id]
    const active = (da?.activeCount ?? 0) > 0
    if (options.da === "active" && !active) return false
    if (options.da === "without" && active) return false
    if (options.da === "history" && !(da?.historyCount ?? 0)) return false
    if (options.stock === "out" && m.stockQty > 0) return false
    if (options.stock === "low" && !(m.stockQty > 0 && m.stockQty < m.minStock)) return false
    if (options.stock === "ok" && !(m.stockQty > 0 && m.stockQty >= m.minStock)) return false
    if (options.category !== "all" && m.category !== options.category) return false
    if (options.supplier !== "all" && ![m.supplier, ...(m.supplierNames ?? [])].includes(options.supplier)) return false
    return true
  }).sort((a, b) => {
    if (options.sort === "urgency") return stockRank(a) - stockRank(b) || (b.minStock - b.stockQty) - (a.minStock - a.stockQty) || a.name.localeCompare(b.name, "fr")
    if (options.sort === "stock") return a.stockQty - b.stockQty || a.name.localeCompare(b.name, "fr")
    return a.name.localeCompare(b.name, "fr")
  })
}
