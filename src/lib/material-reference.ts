/** Références suggérées pour les mousses uniquement.
 * Il s'agit d'une convention de travail testée sur les données fictives SODEPI,
 * pas d'une codification imposée aux autres familles de matières.
 */
export type FoamNature = "PURE" | "AGGLO"
export type FoamFormat = "BLOC" | "PLAQUE" | "ROULEAU"

export const MATERIAL_CATEGORIES = [
  "Mousse", "Tissu", "Ressorts", "Colles", "Fibres & rembourrage",
  "Mercerie", "Emballage & consommables",
] as const
export const MATERIAL_UNITS = ["kg", "m³", "m²", "ml", "m", "pcs", "u", "L", "rouleau", "bloc", "plaque"] as const

/** Préfixe stable : famille + nature + format + densité (sans prix, stock ni localisation). */
export function foamReferencePrefix(nature: string, format: string, density: number): string | null {
  if (nature !== "PURE" && nature !== "AGGLO") return null
  if (!["BLOC", "PLAQUE", "ROULEAU"].includes(format)) return null
  if (nature === "AGGLO" && format === "ROULEAU") return null
  if (!Number.isFinite(density) || density < 0.001 || density > 500) return null
  const densityPart = String(density).replace(".", "P")
  if (!/^\d+(P\d+)?$/.test(densityPart)) return null
  const nat = nature === "PURE" ? "PUR" : "AGG"
  const fmt = format === "BLOC" ? "BLC" : format === "PLAQUE" ? "PLQ" : "ROL"
  return `MP-MOU-${nat}-${fmt}-D${densityPart}`
}

/** Ignore les autres formats de code et évite de réutiliser les numéros existants. */
export function nextFoamReference(prefix: string, existingRefs: readonly string[]): string {
  const start = `${prefix}-`
  const used = new Set<number>()
  for (const raw of existingRefs) {
    if (!raw.toUpperCase().startsWith(start.toUpperCase())) continue
    const suffix = raw.slice(start.length)
    if (/^\d{3,}$/.test(suffix)) used.add(Number(suffix))
  }
  let n = 1
  while (used.has(n)) n++
  return `${prefix}-${String(n).padStart(3, "0")}`
}

export function isManagedMaterialCategory(v: string): boolean {
  return MATERIAL_CATEGORIES.includes(v as typeof MATERIAL_CATEGORIES[number])
}
export function isManagedMaterialUnit(v: string): boolean {
  return MATERIAL_UNITS.includes(v as typeof MATERIAL_UNITS[number])
}

/** P5.5 — Identité technique structurée des mousses, indépendante du fournisseur,
 * du prix, du stock et de l'emplacement. La référence ne varie plus après création.
 */
export const FOAM_GRADES = [
  {value:"STD",label:"Standard / conventionnelle"},
  {value:"HR",label:"Haute résilience (HR)"},
  {value:"VIS",label:"Viscoélastique"},
  {value:"SPE",label:"Qualité spéciale (grade à préciser)"},
] as const
export const FOAM_COLORS = [
  {value:"BLN",label:"Blanc",adjective:"blanche"},
  {value:"BLE",label:"Bleu",adjective:"bleue"},
  {value:"NOI",label:"Noir",adjective:"noire"},
  {value:"VER",label:"Vert",adjective:"verte"},
  {value:"GRI",label:"Gris",adjective:"grise"},
  {value:"ROU",label:"Rouge",adjective:"rouge"},
  {value:"ROS",label:"Rose",adjective:"rose"},
  {value:"JAU",label:"Jaune",adjective:"jaune"},
  {value:"BEI",label:"Beige",adjective:"beige"},
  {value:"ORA",label:"Orange",adjective:"orange"},
  {value:"VIO",label:"Violet",adjective:"violette"},
] as const
export const FOAM_FIRMNESS = [
  {value:"",label:"Non renseignée"},
  {value:"SOU",label:"Souple"},
  {value:"MOY",label:"Moyenne"},
  {value:"FER",label:"Ferme"},
  {value:"TFR",label:"Très ferme"},
] as const

export type FoamSpec = {
  foamNature: string
  foamFormat: string
  foamGrade: string
  foamDensity: number
  foamColor: string
  foamFirmness?: string | null
  foamResilience?: number | null
  foamSupplierGrade?: string | null
  foamLengthCm?: number | null
  foamWidthCm?: number | null
  foamHeightCm?: number | null
  foamThicknessCm?: number | null
}

function canonNumber(n: number): string {
  // Trois décimales maximum pour empêcher des références équivalentes.
  return String(Number(n.toFixed(3))).replace('.', 'P')
}
function numericOk(n: number | null | undefined, max: number): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max && Math.round(n*1000)/1000 === n
}
function foamGradeCode(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9]/g,'')
}

/** Validation serveur ET réutilisable dans les tests de pure logique. */
export function foamSpecErrors(s: FoamSpec): string[] {
  const errors: string[]=[]
  if (!['PURE','AGGLO'].includes(s.foamNature)) errors.push('Nature de mousse invalide')
  if (!['BLOC','PLAQUE','ROULEAU'].includes(s.foamFormat)) errors.push('Format de mousse invalide')
  if (s.foamNature==='AGGLO' && s.foamFormat==='ROULEAU') errors.push('Mousse agglomérée : rouleau interdit')
  if (!FOAM_GRADES.some(g=>g.value===s.foamGrade)) errors.push('Type technique inconnu')
  if (s.foamNature==='AGGLO' && !['STD','SPE'].includes(s.foamGrade)) errors.push('Type technique incompatible avec la mousse agglomérée')
  if (!numericOk(s.foamDensity,500)) errors.push('Densité invalide (0 à 500 kg/m³, 3 décimales)')
  if (!FOAM_COLORS.some(c=>c.value===s.foamColor)) errors.push('Couleur obligatoire ou non reconnue')
  if (s.foamFirmness && !FOAM_FIRMNESS.some(f=>f.value===s.foamFirmness)) errors.push('Fermeté invalide')
  if (s.foamResilience != null && !numericOk(s.foamResilience,100)) errors.push('Résilience invalide (0 à 100 %, 3 décimales)')
  if (s.foamSupplierGrade && (!/^[a-z0-9][a-z0-9 _./-]{0,27}$/i.test(s.foamSupplierGrade) || !foamGradeCode(s.foamSupplierGrade))) errors.push('Grade fournisseur invalide (28 caractères maximum)')
  if (s.foamGrade==='SPE' && !s.foamSupplierGrade?.trim()) errors.push('Une qualité spéciale exige un grade technique distinctif')
  if (!numericOk(s.foamWidthCm,5000)) errors.push('Largeur obligatoire (cm)')
  if (s.foamFormat==='ROULEAU') {
    if (s.foamLengthCm != null && !numericOk(s.foamLengthCm,5000)) errors.push('Longueur fixe invalide (cm)')
  } else if (!numericOk(s.foamLengthCm,5000)) errors.push('Longueur obligatoire (cm)')
  if (s.foamFormat==='BLOC') {
    if (!numericOk(s.foamHeightCm,5000)) errors.push('Hauteur de bloc obligatoire (cm)')
    if (s.foamThicknessCm!=null) errors.push('Un bloc n’a pas de champ épaisseur')
  } else {
    if (!numericOk(s.foamThicknessCm,5000)) errors.push('Épaisseur obligatoire (cm)')
    if (s.foamHeightCm!=null) errors.push('Une plaque ou un rouleau n’a pas de champ hauteur')
  }
  return errors
}

/** Préfixe lisible et complet : attributs variables exclus. */
export function foamReferencePrefixFromSpec(s: FoamSpec): string | null {
  if (foamSpecErrors(s).length) return null
  const nat=s.foamNature==='PURE'?'PUR':'AGG'
  const fmt=s.foamFormat==='BLOC'?'BLC':s.foamFormat==='PLAQUE'?'PLQ':'ROL'
  const parts=['MP','MOU',nat,s.foamGrade,`D${canonNumber(s.foamDensity)}`,s.foamColor,fmt]
  if(s.foamFirmness) parts.push(s.foamFirmness)
  if(s.foamResilience!=null) parts.push(`RES${canonNumber(s.foamResilience)}`)
  if(s.foamSupplierGrade?.trim()) {
    const g=foamGradeCode(s.foamSupplierGrade)
    // Limite le nom du segment sans perte de distinction : le hash de 6 chiffres
    // résout les tronquages et garde une référence transportable.
    let code=g
    if(g.length>16){
      let hash=2166136261
      for(const char of g) hash=Math.imul(hash ^ char.charCodeAt(0),16777619)>>>0
      code=`${g.slice(0,9)}${hash.toString(36).toUpperCase().padStart(7,'0').slice(-7)}`
    }
    parts.push(`GF${code}`)
  }
  if(s.foamLengthCm!=null) parts.push(`LG${canonNumber(s.foamLengthCm)}`)
  parts.push(`LR${canonNumber(s.foamWidthCm!)}`)
  parts.push(`${s.foamFormat==='BLOC'?'HT':'EP'}${canonNumber((s.foamFormat==='BLOC'?s.foamHeightCm:s.foamThicknessCm)!)}`)
  return parts.join('-')
}

/** Identité unique indépendante d'une référence manuellement personnalisée. */
export function foamIdentityKey(s: FoamSpec): string | null {
  if(foamSpecErrors(s).length) return null
  return ["FOAM-V1",s.foamNature,s.foamFormat,s.foamGrade,canonNumber(s.foamDensity),s.foamColor,
    s.foamFirmness||'',s.foamResilience == null?'':canonNumber(s.foamResilience),
    (s.foamSupplierGrade||'').trim().toUpperCase().replace(/\s+/g,' '),
    s.foamLengthCm==null?'':canonNumber(s.foamLengthCm),canonNumber(s.foamWidthCm!),
    s.foamHeightCm==null?'':canonNumber(s.foamHeightCm),s.foamThicknessCm==null?'':canonNumber(s.foamThicknessCm)
  ].join('|')
}

/** Dimensions techniques obligatoires dans la description, même personnalisée. */
export function foamDimensionsText(s:FoamSpec): string {
  if(s.foamFormat==='ROULEAU')return `largeur ${s.foamWidthCm} × épaisseur ${s.foamThicknessCm} cm${s.foamLengthCm!=null?`, longueur fixe ${s.foamLengthCm} cm`:', longueur variable'}`
  return `${s.foamLengthCm} × ${s.foamWidthCm} × ${s.foamFormat==='BLOC'?s.foamHeightCm:s.foamThicknessCm} cm`
}

/** Texte proposé : éditable, sans influencer silencieusement l'identité technique. */
export function foamDescriptionFromSpec(s: FoamSpec): {name:string,description:string} | null {
  if (foamSpecErrors(s).length) return null
  const nature=s.foamNature==='PURE'?'pure':'agglomérée'
  const grade={STD:'standard',HR:'haute résilience',VIS:'viscoélastique',SPE:'spéciale'}[s.foamGrade as 'STD'|'HR'|'VIS'|'SPE']
  const color=FOAM_COLORS.find(c=>c.value===s.foamColor)!.adjective
  const fmt={BLOC:'bloc',PLAQUE:'plaque',ROULEAU:'rouleau'}[s.foamFormat as FoamFormat]
  const dims=foamDimensionsText(s)
  const firm=FOAM_FIRMNESS.find(x=>x.value===s.foamFirmness)?.label.toLowerCase()
  const suffix=[firm?`fermeté ${firm}`:null,s.foamResilience!=null?`résilience ${s.foamResilience} %`:null,s.foamSupplierGrade?`grade technique ${s.foamSupplierGrade.trim()}`:null].filter(Boolean).join(', ')
  return {
    name:`Mousse ${nature} ${s.foamGrade} D${s.foamDensity} ${color} — ${fmt} ${dims}`,
    description:`Mousse ${nature} ${grade}, densité ${s.foamDensity} kg/m³, ${color}, format ${fmt}, dimensions ${dims}${suffix?', '+suffix:''}.`,
  }
}
