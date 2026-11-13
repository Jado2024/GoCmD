/** Formulaire navigateur : modèles de lignes ponctuelles sans SKU. */
export const GENERIC_TEMPLATES = {"GEN-MAT":{family:"MATELAS",unit:"u"},"GEN-MOU":{family:"PLAQUE_MOUSSE",unit:"u"},"GEN-SAL":{family:"SALON",unit:"ml"},"GEN-DIV":{family:"DIVERS",unit:"u"}} as const
export type GenericTemplate = keyof typeof GENERIC_TEMPLATES
/** D-GEN-01 : couche physique d'un mélange mousse (une PURE + une AGGLO minimum). */
export type GenericFoamLayer = {nature:"PURE"|"AGGLO";densityKgM3:number;thicknessCm:number}
export type GenericSpec = {template:GenericTemplate;description:string;specifications:string;lengthCm?:number;widthCm?:number;heightCm?:number;requiresPreparation:boolean
  // D-GEN-01 (option D) : champs taxonomiques exigés par le trigger V16
  // go_v16_product_insert — MATELAS exige noyau+composition+finition (+densité
  // ou couches), PLAQUE_MOUSSE exige nature+densité+grade, SALON aucun.
  coreType?:"SANS_RESSORTS"|"BONNELL"|"ENSACHES"
  foamComposition?:"PURE"|"MELANGE"|"AGGLO"
  mattressFinish?:"SANS"|"TOPPER"|"ALESE"
  foamNature?:"PURE"|"AGGLO"
  foamDensity?:number
  foamGrade?:string
  foamLayers?:GenericFoamLayer[]
}
