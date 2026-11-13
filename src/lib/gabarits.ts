/** Catalogue graphique Richbond. Dessins indicatifs, à vérifier en atelier avant découpe.
 * Pour 11 à 24 : L issu de la largeur du produit ; D/J saisis. Pour 21 à 24 : S/T obliques, et non projections.
 * Pour 31-34 : S est une longueur horizontale de l’encoche/décroché.
 * 11 : facturation automatique D ; 12–14 : facturation manuelle en attente de validation.
 * 21/22 : MAX(D,J) ; 23 : J + projection horizontale T ; 24 : J + projection horizontale S.
 * 31-34 : J ; 41/51 : pentes K/L symétriques à 45°, W calculé depuis la hauteur totale H et les lignes D/J ; K/L validés.
 * 52 n’appartient pas au catalogue actif (ancien exemple, non proposé en commande).
 */
export const GABARITS = [
  { code: "STD", name: "Droit", path: "M12 14 H108 V65 H12 Z", fields: [], hint: "Longueur droite, en mètres" },
  { code: "06", name: "Spécial · facturation manuelle", path: "M12 65 L12 23 L49 23 L72 9 L108 23 L108 65 Z", fields: ["D", "J"], hint: "Gabarit libre : longueur facturée saisie manuellement" },
  { code: "11", name: "Pente à droite", path: "M14 15 H108 L65 65 H14 Z", fields: ["D","J"] },
  { code: "12", name: "Pente droite sortante", path: "M14 15 H73 L108 65 H14 Z", fields: ["D","J"] },
  { code: "13", name: "Pente gauche rentrante", path: "M14 15 H108 V65 H48 Z", fields: ["D","J"] },
  { code: "14", name: "Pente gauche sortante", path: "M45 15 H108 V65 H14 Z", fields: ["D","J"] },
  { code: "21", name: "Double pente extérieure", path: "M14 15 H108 L92 65 H47 Z", fields: ["D","J","S","T"] },
  { code: "22", name: "Double pente intérieure", path: "M42 15 H89 L108 65 H14 Z", fields: ["D","J","S","T"] },
  { code: "23", name: "Deux pentes parallèles", path: "M41 15 H108 L86 65 H14 Z", fields: ["D","J","S","T"] },
  { code: "24", name: "Double pente inversée", path: "M14 15 H90 L108 65 H41 Z", fields: ["D","J","S","T"] },
  { code: "31", name: "Encoche à gauche", path: "M14 15 H35 V35 H62 V15 H108 V65 H14 Z", fields: ["D","J","B","P","S"] },
  { code: "32", name: "Encoche à droite", path: "M14 15 H74 V35 H96 V15 H108 V65 H14 Z", fields: ["D","J","B","P","S"] },
  { code: "33", name: "Décroché gauche", path: "M14 35 H35 V15 H108 V65 H14 Z", fields: ["D","J","P","S"] },
  { code: "34", name: "Décroché droit", path: "M14 15 H87 V35 H108 V65 H14 Z", fields: ["D","J","P","S"] },
  { code: "41", name: "Pointe 5 côtés · largeur extrême", path: "M14 47 L60 12 L108 47 L85 65 H37 Z", fields: ["J","L","K","H"] },
  { code: "51", name: "Hexagone · largeur extrême", path: "M14 43 L43 15 H79 L108 43 L88 65 H34 Z", fields: ["D","J","L","K","H"] },
] as const

export type GabaritCode = (typeof GABARITS)[number]["code"]
export const GABARIT_CODES = GABARITS.map((g) => g.code) as [GabaritCode, ...GabaritCode[]]
export const MEASURE_NAMES: Record<string,string> = {
  D: "D · Dos (m)", J: "J · Assise (m)", L: "L · Largeur du profil (m, catalogue)",
  S: "S · Cote S du dessin (m)", T: "T · Cote T du dessin (m)",
  B: "B · Décalage de l’encoche (m)", P: "P · Profondeur verticale (m)", K: "K · Côté oblique haut (m)", H: "H · Hauteur verticale totale (m)", W: "W · Distance calculée entre les pointes extrêmes (m)",
  largeurSalon: "Largeur du salon (m)", largeurAssise: "Largeur d'assise (m)",
  profondeurCoin: "Profondeur du coin (m)",
}
export function measureLabelForGabarit(code:string, field:string):string {
  if (["21","22","23","24"].includes(code) && field==="S") return "S · Longueur oblique gauche (m)"
  if (["21","22","23","24"].includes(code) && field==="T") return "T · Longueur oblique droite (m)"
  if (["31","32"].includes(code) && field==="S") return "S · Largeur horizontale de l’encoche (m)"
  if (["33","34"].includes(code) && field==="S") return "S · Dépassement horizontal (m)"
  if (["41","51"].includes(code) && field==="L") return "L · Côté oblique bas (m) — différent de la largeur article"
  return MEASURE_NAMES[field] ?? field
}
export function gabaritByCode(code: string) {
  return GABARITS.find((g)=>g.code === code)
}
/** Gabarits à facturation automatique, règles atelier. Le 06 reste toujours manuel. */
export function billingIsManual(code: string) { return !["11","21","22","23","24","31","32","33","34","41","51"].includes(code) }
