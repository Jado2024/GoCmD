/** Règles métier GoCmd V16 — composition indépendante du noyau (ressorts ou non). */
export const PRODUCT_FAMILIES = ["MATELAS", "BANQUETTE", "SALON", "GAUFRETTE", "PLAQUE_MOUSSE", "OUATE"] as const
export type ProductFamily = typeof PRODUCT_FAMILIES[number]
export const CORE_TYPES = ["SANS_RESSORTS", "BONNELL", "ENSACHES"] as const
export const FOAM_COMPOSITIONS = ["PURE", "MELANGE", "AGGLO"] as const
export const MATTRESS_FINISHES = ["SANS", "TOPPER", "ALESE"] as const
export const UPHOLSTERIES = ["NUE", "TISSU"] as const
export const FOAM_NATURES = ["PURE", "AGGLO"] as const
export type TechnicalSpecs = {
  family: string
  height?: number | null
  coreType?: string | null
  foamComposition?: string | null
  mattressFinish?: string | null
  upholstery?: string | null
  foamNature?: string | null
  foamGrade?: string | null
  foamDensity?: number | null
  foamLayers?: string | null
}
export function validateTechnicalSpecs(p: TechnicalSpecs): string | null {
  if(p.family === "NEGOCE") return null // unité validée via la matière liée, jamais via une famille fabriquée
  const mattressOrSeat = p.family === "MATELAS" || p.family === "BANQUETTE"
  if (mattressOrSeat) {
    if (!CORE_TYPES.includes(p.coreType as typeof CORE_TYPES[number])) return "Type de noyau obligatoire (sans ressorts, Bonnell, ensachés)"
    if (!FOAM_COMPOSITIONS.includes(p.foamComposition as typeof FOAM_COMPOSITIONS[number])) return "Composition de mousse obligatoire"
    if (p.family === "MATELAS" && (!MATTRESS_FINISHES.includes(p.mattressFinish as typeof MATTRESS_FINISHES[number]) || p.upholstery)) return "Matelas : sans, topper OU alèse uniquement"
    if (p.family === "BANQUETTE" && (!UPHOLSTERIES.includes(p.upholstery as typeof UPHOLSTERIES[number]) || p.mattressFinish)) return "Banquette : tissu ou nue, sans option matelas"
    if (p.foamNature) return "La nature pure/agglo des plaques ne remplace pas la composition du noyau"
    if (p.foamComposition === "MELANGE") {
      if (p.foamDensity != null) return "Mélange : saisir les densités séparément dans les couches"
      const layers = parseLayers(p.foamLayers)
      if (!layers || layers.length < 2 || !layers.some(l => l.nature === "PURE") || !layers.some(l => l.nature === "AGGLO"))
        return "Mélange : au moins une couche PURE et une couche AGGLO avec densité/épaisseur"
      if (p.height != null && Number.isFinite(p.height) && layers.reduce((t,l)=>t+l.thicknessCm,0) > p.height + 0.001)
        return "Mélange : épaisseurs des couches supérieures à l'épaisseur totale du produit"
    } else {
      if (!validDensity(p.foamDensity)) return "Densité mousse en kg/m³ obligatoire"
      if (p.foamLayers) return "Couches détaillées réservées aux mélanges"
    }
  } else if (p.family === "PLAQUE_MOUSSE") {
    if (!FOAM_NATURES.includes(p.foamNature as typeof FOAM_NATURES[number])) return "Plaque : nature PURE ou AGGLO obligatoire"
    if (!validDensity(p.foamDensity)) return "Plaque : densité kg/m³ obligatoire"
    if (!p.foamGrade?.trim()) return "Plaque : type/qualité obligatoire"
    if (p.coreType || p.foamComposition || p.mattressFinish || p.upholstery || p.foamLayers) return "Plaque : ni noyau, ni topper, ni habillage"
  } else if (p.family === "OUATE") {
    if (p.coreType || p.foamComposition || p.mattressFinish || p.upholstery || p.foamNature || p.foamDensity || p.foamLayers)
      return "Ouate : produit fabrique vendu au kg, sans options de matelas ou de plaque"
  } else if (["SALON", "GAUFRETTE"].includes(p.family)) {
    if (p.coreType || p.foamComposition || p.mattressFinish || p.upholstery || p.foamNature || p.foamDensity || p.foamLayers)
      return "Salon/gaufrette : caractéristiques techniques non définies par ce référentiel"
  } else return "Famille non reconnue"
  return null
}
function validDensity(d: number | null | undefined): boolean { return d != null && Number.isFinite(d) && d > 0 && d <= 500 }
export function parseLayers(raw: string | null | undefined): Array<{nature:string;densityKgM3:number;thicknessCm:number;grade?:string}> | null {
  if (!raw || raw.length > 5000) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value) || value.length > 12) return null
    if (!value.every(x => x && typeof x === "object" && ["PURE", "AGGLO"].includes(x.nature) && validDensity(x.densityKgM3) && Number.isFinite(x.thicknessCm) && x.thicknessCm > 0 && x.thicknessCm <= 150)) return null
    return value
  } catch { return null }
}
export function unitForFamily(family: string): "ml" | "u" | "kg" {
  // Unité des plaques = u uniquement pour cette simulation ; tarif réel à valider.
  return family === "OUATE" ? "kg" : ["MATELAS", "PLAQUE_MOUSSE"].includes(family) ? "u" : "ml"
}
