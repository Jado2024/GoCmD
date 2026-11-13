import { gabaritByCode, MEASURE_NAMES } from "./gabarits"
import { automaticBilledLength, geometryTrapeze, geometryStep, geometryPointes, GABARIT_TOLERANCE_M } from "./geometry-engine"
/** Conversion saisie commerciale => pièces physiques à étiqueter.
 * Pas de dépendance Prisma : la même logique peut être testée indépendamment.
 */
export const SHAPES = ["rectangle", "L", "U", "trapeze", "angle_coupe", "arrondi", "gabarit"] as const
export type Shape = (typeof SHAPES)[number]

export const SHAPE_LABELS: Record<Shape, string> = {
  rectangle: "Rectangle",
  L: "Forme en L",
  U: "Forme en U",
  trapeze: "Trapèze",
  angle_coupe: "Angle coupé",
  arrondi: "Bout arrondi",
  gabarit: "Gabarit numéroté",
}

export const SHAPE_MEASURES: Record<Shape, { key: string; label: string }[]> = {
  rectangle: [],
  gabarit: [],
  L: [{key:"returnLength",label:"Longueur du retour (cm)"},{key:"returnWidth",label:"Largeur du retour (cm)"}],
  U: [{key:"leftReturn",label:"Retour gauche (cm)"},{key:"rightReturn",label:"Retour droit (cm)"},{key:"baseDepth",label:"Profondeur de la base (cm)"}],
  trapeze: [{key:"smallBase",label:"Petite base (cm)"}],
  angle_coupe: [{key:"cutLength",label:"Coupe sur longueur (cm)"},{key:"cutWidth",label:"Coupe sur largeur (cm)"}],
  arrondi: [{key:"radius",label:"Rayon (cm)"}],
}

export interface PartSpec {
  label: string
  partRef?: string
  linearMeters?: number
  gabaritCode?: string
  billingMode?: "manual" | "computed"
  shape: Shape
  lengthCm: number
  widthCm: number
  heightCm: number
  count: number // nombre de banquettes identiques dans CE salon
  extra?: Record<string, number>
  note?: string
}

export interface BuildSpecsInput {
  orderRef: string
  lineNo: number
  label: string
  quantity: number // métrage facturable pour BANQUETTE/GAUFRETTE/SALON ; nombre de pièces pour MATELAS
  unit: string
  family: string
  pieceCount?: number // uniquement pour une ligne simple, particulièrement ml
  ensembleCount?: number // nombre de salons identiques, même si la vente est au ml
  parts?: PartSpec[] // salon : L01...LN, une banquette physique par part
  dimensionless?: boolean // GEN-DIV sans dimensions physiques pertinentes
  defaultDimensions: { lengthCm: number; widthCm: number; heightCm: number }
  shape?: Shape
  extra?: Record<string, number>
}

export interface BuiltPiece {
  code: string
  salonNo: number
  elementNo: number
  sequence: number
  label: string
  partRef: string | null
  linearMeters: number | null
  gabaritCode: string | null
  billingMode: string
  shape: Shape
  lengthCm: number
  widthCm: number
  heightCm: number
  dimensionsExtra: string | null
  note: string | null
}

export function buildPieces(input: BuildSpecsInput): BuiltPiece[] {
  const salon = /salon/i.test(input.family)
  if (!(input.quantity > 0) || !Number.isFinite(input.quantity)) throw new Error("Quantité commerciale invalide")
  if (salon && input.unit !== "ml") throw new Error("Un salon doit être facturé au mètre linéaire")
  if (!salon && input.ensembleCount != null && input.ensembleCount !== 1) throw new Error("Les ensembles multiples sont réservés aux salons")
  if(input.unit === "kg") {
    // Une étiquette identifie le lot commercial d'ouate pesé ; pas une étiquette par kg.
    if (input.family !== "OUATE" || input.pieceCount != null && input.pieceCount !== 1 || input.parts && (input.parts.length !== 1 || input.parts[0].count !== 1))
      throw new Error("Ouate : un lot commercial par ligne, en kg ; divisions de livraison non gerees")
  }
  if (input.unit === "ml") {
    // C4-01 (contre-audit CASCADE4) : sans cette garde, une ligne ml simple avec
    // pieceCount>1 produisait N étiquettes portant CHACUNE le métrage total de la
    // ligne (10 ml en 3 pièces donnait 3 étiquettes de 10 m : 30 m étiquetés pour
    // 10 m facturés — sur-étiquetage ×N). Le découpage réel d'une ligne au
    // métre passe par « parts » avec les métrages réels, que le contrôle de
    // somme (fin de fonction) ramène à la quantité facturée.
    if (input.pieceCount != null && input.pieceCount !== 1)
      throw new Error("Une ligne simple au métre produit une seule étiquette : saisir les pièces réelles et leurs métrages pour une livraison divisée")
  }
  if(input.unit==="u") {
    if(!Number.isSafeInteger(input.quantity))throw new Error("Une vente à l'unité exige une quantité entière")
    if(input.pieceCount != null && input.pieceCount !== 1)throw new Error("Une unité vendue correspond à une seule étiquette")
    if(input.parts?.length && (input.parts.length !== 1 || input.parts[0].count !== 1))throw new Error("Une unité vendue correspond à une seule pièce physique")
  }
  const copies = salon ? (input.ensembleCount ?? 1) : input.unit === "u" ? input.quantity : 1
  if (!Number.isInteger(copies) || copies < 1 || copies > 50) throw new Error("Quantité d'ensembles invalide (1–50)")
  const parts: PartSpec[] = input.parts && input.parts.length
    ? input.parts
    : (salon ? [] : [{
        label: input.label,
        shape: input.shape ?? "rectangle",
        ...input.defaultDimensions,
        count: input.unit === "u" ? 1 : (input.pieceCount ?? 1),
        linearMeters: input.unit === "ml" ? input.quantity : undefined,
        extra: input.extra,
      }])
  if (parts.length === 0 || parts.length > 50) throw new Error("Indiquer entre 1 et 50 pièces physiques par ligne")
  const result: BuiltPiece[] = []
  for (let s = 1; s <= copies; s++) {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!Number.isInteger(part.count) || part.count < 1 || part.count > 50) throw new Error(`Nombre de pièces invalide, ligne ${i+1}`)
      for (const n of [part.lengthCm, part.widthCm, part.heightCm]) {
        if (!Number.isFinite(n) || n > 1500 || (input.dimensionless ? n!==0 : n<=0)) throw new Error(`Dimensions invalides, ligne ${i+1}`)
      }
      if (!SHAPES.includes(part.shape)) throw new Error(`Forme inconnue, ligne ${i+1}`)
      if(input.dimensionless && (part.shape!=="rectangle" || (part.gabaritCode && part.gabaritCode!=="STD")))
        throw new Error("GEN-DIV sans dimensions : gabarit technique non autorisé")
      if (part.linearMeters != null && (!Number.isFinite(part.linearMeters) || part.linearMeters <= 0 || part.linearMeters > 1000)) {
        throw new Error(`Métrage invalide, banquette ${i+1}`)
      }
      if (part.partRef && part.partRef.trim().length > 40) throw new Error(`Référence de banquette trop longue, ligne ${i+1}`)
      // Les cotes géométriques ne sont pas celles du profil de mousse.
      const extra = { ...(part.extra ?? {}) }
      let billed = part.linearMeters
      if (part.gabaritCode) {
        const gab = gabaritByCode(part.gabaritCode)
        if (!gab) throw new Error(`Gabarit inconnu, ligne ${i+1}`)
        // L n'est jamais redemandé : il provient du code article (largeur du profil).
        if (["11","12","13","14","21","22","23","24"].includes(gab.code)) {
          const catalogueL=part.widthCm/100
          if (extra.L != null && Math.abs(extra.L-catalogueL)>0.001) {
            throw new Error(`Gabarit ${gab.code} : L doit correspondre à la largeur du code article`)
          }
          extra.L=catalogueL
        }
        for (const field of gab.fields) {
          if (gab.code !== "06" && (!Number.isFinite(extra[field]) || extra[field] <= 0)) {
            throw new Error(`${MEASURE_NAMES[field] ?? field} manquant(e), ligne ${i+1}`)
          }
        }
        if (["11","12","13","14","21","22","23","24"].includes(gab.code)) {
          const geo=geometryTrapeze(gab.code, { D:extra.D, J:extra.J, L:extra.L, S:extra.S, T:extra.T })
          // Ne jamais écraser les D/J/S/T saisis. Données calculées séparées.
          extra.projectionS=geo.horizontalLeftM
          extra.projectionT=geo.horizontalRightM
          extra.obliqueGauche=geo.slopeLeftM ?? 0
          extra.obliqueDroite=geo.slopeRightM ?? 0
          extra.longueurBruteIndicative=geo.grossLengthM
          extra.angleGaucheDegres=geo.angleLeftDegrees ?? 0
          extra.angleDroiteDegres=geo.angleRightDegrees ?? 0
          extra.surfaceChutesTheoriqueM2=geo.wasteAreaM2
          extra.volumeChutesTheoriqueM3=geo.wasteAreaM2 * part.heightCm / 100
          if (geo.expectedD !== null) {
            extra.dosTheorique=geo.expectedD
            extra.ecartDos=geo.gapD
            extra.cotesCoherentes=geo.coherent ? 1 : 0
            if (!geo.coherent) throw new Error(`Gabarit ${gab.code} : cotes D/J/S/T incohérentes (écart ${Math.abs(geo.gapD).toFixed(3)} m) ; corriger avant validation`)
          }
          // 11 : D ; 21/22 : MAX(D,J) ; 23 : J + projection T ; 24 : J + projection S.
          if (['11','21','22','23','24'].includes(gab.code)) {
            if (part.billingMode === 'manual') throw new Error(`Gabarit ${gab.code} : facturation automatique obligatoire`)
            const expected=automaticBilledLength(gab.code,{D:extra.D,J:extra.J,L:extra.L,S:extra.S,T:extra.T})!
            // Écart physique entre brut de débit et règle de facturation : même
            // tolérance atelier que le contrôle de cohérence D/J/S/T (15 mm),
            // sinon une saisie acceptée à l'écran était refusée au POST.
            if (Math.abs(expected-geo.grossLengthM)>GABARIT_TOLERANCE_M) throw new Error(`Gabarit ${gab.code} : écart entre longueur brute et règle de facturation supérieur à la tolérance atelier (15 mm)`)
            if (billed != null && Math.abs(billed-expected)>0.005) throw new Error(`Gabarit ${gab.code} : métrage transmis incohérent avec la formule`)
            billed=expected
          } else if (part.billingMode === 'computed') {
            throw new Error(`Gabarit ${gab.code} : règle de facturation non validée`)
          }
        }
        if (["31","32","33","34"].includes(gab.code)) {
          const L=part.widthCm/100
          const geo=geometryStep(gab.code,{D:extra.D,J:extra.J,L,P:extra.P,S:extra.S,B:extra.B})
          if (!geo.coherent) throw new Error(`Gabarit ${gab.code} : dimensions D/J/S incohérentes`)
          extra.largeurCatalogue=L
          extra.longueurBruteIndicative=geo.grossLengthM
          extra.surfaceChutesTheoriqueM2=geo.wasteAreaM2
          extra.volumeChutesTheoriqueM3=geo.wasteAreaM2*part.heightCm/100
          // Pour les 31 à 34, facturation atelier basée sur J saisi.
          if (part.billingMode === 'manual') throw new Error(`Gabarit ${gab.code} : facturation automatique obligatoire`)
          const expected=automaticBilledLength(gab.code,{D:extra.D,J:extra.J})!
          if (billed != null && Math.abs(billed-expected)>0.005) throw new Error(`Gabarit ${gab.code} : métrage transmis incohérent avec J`)
          billed=expected
        }
        if (["41","51"].includes(gab.code)) {
          // H totale saisie, W calculé depuis la géométrie symétrique.
          // Les données externes ne peuvent jamais imposer W.
          if (extra.W != null) throw new Error(`Gabarit ${gab.code} : W doit être calculé, ne pas le saisir`)
          const geo=geometryPointes(gab.code as '41'|'51',{D:extra.D,J:extra.J,K:extra.K,L:extra.L,H:extra.H})
          const w=geo.distancePointesM
          if (part.billingMode === 'manual') throw new Error(`Gabarit ${gab.code} : facturation automatique sur W obligatoire`)
          if (billed != null && Math.abs(billed-w)>0.005) throw new Error(`Gabarit ${gab.code} : longueur facturée différente de W calculé`)
          extra.W=w
          extra.distancePointesM=w
          extra.longueurBruteIndicative=geo.brutM
          extra.angleHautKDegres=geo.angleKDeg
          extra.angleBasLDegres=geo.angleLDeg
          extra.hauteurHautM=geo.hauteurHautM
          extra.hauteurBasM=geo.hauteurBasM
          extra.projectionK=geo.projectionK
          extra.projectionL=geo.projectionL
          extra.profondeurBruteM=geo.profondeurBruteM
          extra.surfaceChutesTheoriqueM2=geo.wasteAreaM2
          extra.volumeChutesTheoriqueM3=geo.wasteAreaM2*part.heightCm/100
          billed=w
        }
        if (part.billingMode === "computed" && !['11','21','22','23','24','31','32','33','34','41','51'].includes(gab.code)) {
          throw new Error(`Gabarit ${gab.code} : formule de facturation non validée`)
        }
      }
      if (input.unit === "ml" && (billed == null || !(billed > 0))) {
        throw new Error(`Longueur à facturer obligatoire (ml), ligne ${i+1}`)
      }
      for (const {key} of SHAPE_MEASURES[part.shape]) {
        if (!Number.isFinite(extra[key]) || extra[key] <= 0 || extra[key] > 1500) {
          throw new Error(`Cote du gabarit « ${key} » manquante ou invalide, ligne ${i+1}`)
        }
      }
      for (let k = 1; k <= part.count; k++) {
        result.push({
          code: `${input.orderRef}-${String(input.lineNo).padStart(3,"0")}-S${String(s).padStart(2,"0")}-L${String(i+1).padStart(2,"0")}-P${String(k).padStart(2,"0")}`,
          salonNo: s,
          elementNo: i+1,
          sequence: result.length+1,
          label: part.label.trim() || input.label,
          partRef: part.partRef?.trim() || `L${String(i+1).padStart(2,"0")}`,
          linearMeters: billed ?? null,
          gabaritCode: part.gabaritCode ?? null,
          billingMode: ['11','21','22','23','24','31','32','33','34','41','51'].includes(part.gabaritCode??'') ? 'computed' : 'manual',
          shape: part.shape,
          lengthCm: part.lengthCm,
          widthCm: part.widthCm,
          heightCm: part.heightCm,
          dimensionsExtra: Object.keys(extra).length ? JSON.stringify(extra) : null,
          note: part.note?.trim() || null,
        })
      }
    }
  }
  if (input.unit === "ml" && input.parts?.length) {
    const total = result.reduce((sum, piece) => sum + (piece.linearMeters ?? 0), 0)
    if (Math.abs(Math.round(total * 1000) / 1000 - input.quantity) > 0.001) {
      throw new Error("La quantité facturée doit égaler la somme des métrages des pièces")
    }
  }
  if(input.unit === "u" && result.length !== input.quantity)throw new Error("Nombre d’étiquettes incohérent avec la quantité à l’unité")
  if (result.length > 500) throw new Error("Maximum de 500 étiquettes par ligne")
  return result
}
