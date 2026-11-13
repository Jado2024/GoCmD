/**
 * Relations géométriques déduites des dessins Richbond.
 * Cotes et longueur en mètres ; calculs intermédiaires non arrondis.
 * Les formules géométriques et les règles commerciales sont gérées séparément.
 */
/**
 * Contrôle en plan des gabarits Richbond 11..24.
 * L = profondeur/largeur du profil extraite du catalogue en mètres.
 * D/J sont des cotes SAISIES ; S/T sont les LONGUEURS des flancs obliques.
 * Les projections sur l'axe du dos/assise proviennent de Pythagore.
 * D/J ne sont jamais remplacés par le résultat théorique ; l'écart est signalé.
 * Le rectangle enveloppant est calculé directement depuis les quatre sommets du profil.
 * Hypothèse de coupe : dos et assise horizontaux, profondeur L perpendiculaire.
 * Le calcul représente le brut géométrique AVANT toute marge de sciage ou orientation alternative.
 * Facturation : 21/22 = MAX(D,J), 23 = J+t, 24 = J+s ; 31–34 = J ; 41/51 = W calculé à partir de H.
 * Gabarit 11 : longueur facturée D ; 12–14 : facturation manuelle en attente de validation atelier.
 */
export interface PointMetres { x: number; y: number }
/** Rectangle minimal à axes fixes, autour du contour réellement reconstruit. */
export function rectangleEnveloppant(points: readonly PointMetres[]) {
  if (points.length < 3 || !points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))) {
    throw new Error('Sommets géométriques invalides')
  }
  const minX=Math.min(...points.map(p=>p.x)), maxX=Math.max(...points.map(p=>p.x))
  const minY=Math.min(...points.map(p=>p.y)), maxY=Math.max(...points.map(p=>p.y))
  return { minX, maxX, minY, maxY, longueurBrute:maxX-minX, profondeurBrute:maxY-minY }
}
/** Surface réelle du polygone par formule du lacet (shoelace). */
export function surfacePolygone(points: readonly PointMetres[]) {
  if (points.length<3) throw new Error('Un polygone exige au moins trois sommets')
  let twice=0
  for (let i=0;i<points.length;i++) {
    const p=points[i], q=points[(i+1)%points.length]
    twice+=p.x*q.y-q.x*p.y
  }
  return Math.abs(twice)/2
}

export const GABARIT_TOLERANCE_M = 0.015 // 1,5 cm : contrôle indicatif, validation atelier à prévoir
export interface TrapezeMeasures {
  D: number; J: number; L: number; S?: number; T?: number
}
export interface TrapezeResult {
  areaM2: number
  slopeLeftM: number | null
  slopeRightM: number | null
  horizontalLeftM: number
  horizontalRightM: number
  expectedD: number | null
  gapD: number
  coherent: boolean
  grossLengthM: number
  lengthBilledM: number | null
  angleLeftDegrees: number | null
  angleRightDegrees: number | null
  grossAreaM2: number
  wasteAreaM2: number
  verticesM: PointMetres[]
  rectangleMinXM: number
  rectangleMaxXM: number
}
export function geometryTrapeze(code: string, measures: TrapezeMeasures): TrapezeResult {
  const { D, J, L, S, T } = measures
  if (![D, J, L].every(v=>Number.isFinite(v) && v>0 && v<=100)) {
    throw new Error('Les cotes saisies D/J et la largeur du produit L doivent être positives')
  }
  const delta=Math.abs(D-J)
  let xS=0, xT=0
  let slopeLeftM:number|null=null, slopeRightM:number|null=null
  let expectedD:number|null=null
  let grossLengthM:number
  let verticesM:PointMetres[]=[]
  let leftAngle: number|null=null, rightAngle: number|null=null
  if (['11','12','13','14'].includes(code)) {
    if (['11','13'].includes(code) && D <= J) throw new Error(`Gabarit ${code} : D doit dépasser J`)
    if (['12','14'].includes(code) && J <= D) throw new Error(`Gabarit ${code} : J doit dépasser D`)
    const oblique=Math.hypot(L,delta)
    if (['11','12'].includes(code)) slopeRightM=oblique
    else slopeLeftM=oblique
    // Sommets rangés dans le sens horaire : angle haut gauche, haut droit,
    // bas droit, bas gauche. Coordonnées en mètres, base d'axe non tournée.
    if (code==='11') verticesM=[{x:0,y:L},{x:D,y:L},{x:J,y:0},{x:0,y:0}]
    else if (code==='12') verticesM=[{x:0,y:L},{x:D,y:L},{x:J,y:0},{x:0,y:0}]
    else if (code==='13') verticesM=[{x:0,y:L},{x:D,y:L},{x:D,y:0},{x:D-J,y:0}]
    else verticesM=[{x:J-D,y:L},{x:J,y:L},{x:J,y:0},{x:0,y:0}]
    const angle=Math.atan2(L,delta)*180/Math.PI
    if (slopeLeftM!==null) leftAngle=angle
    if (slopeRightM!==null) rightAngle=angle
  } else if (['21','22','23','24'].includes(code)) {
    if (![S,T].every(v=>typeof v==='number' && Number.isFinite(v) && v!>=L && v!<=100)) {
      throw new Error('Obliques S et T obligatoires : elles doivent être au moins aussi longues que L')
    }
    slopeLeftM=S!; slopeRightM=T!
    xS=Math.sqrt(Math.max(0,S!*S!-L*L))
    xT=Math.sqrt(Math.max(0,T!*T!-L*L))
    // Coordonnées horizontales des quatre sommets du profil, selon la figure Richbond.
    // Enveloppe = max des abscisses - min des abscisses, avec les chutes.
    let xTopLeft=0, xBottomLeft=0, xTopRight=0, xBottomRight=0
    if (code==='21') { xTopLeft=0; xTopRight=D; xBottomLeft=xS; xBottomRight=D-xT; expectedD=J+xS+xT }
    else if (code==='22') { xBottomLeft=0; xTopLeft=xS; xTopRight=xS+D; xBottomRight=xS+D+xT; expectedD=J-xS-xT }
    else if (code==='23') { xBottomLeft=0; xTopLeft=xS; xTopRight=xS+D; xBottomRight=xS+D-xT; expectedD=J-xS+xT }
    else { xTopLeft=0; xTopRight=D; xBottomLeft=xS; xBottomRight=D+xT; expectedD=J+xS-xT }
    // Les abscisses reflètent D saisi ; la cohérence avec J saisi est vérifiée plus bas.
    verticesM=[
      {x:xTopLeft,y:L},{x:xTopRight,y:L},
      {x:xBottomRight,y:0},{x:xBottomLeft,y:0},
    ]
    leftAngle=Math.atan2(L,xS)*180/Math.PI
    rightAngle=Math.atan2(L,xT)*180/Math.PI
    if (expectedD<=0) throw new Error('Cotes incohérentes : le dos théorique serait négatif')
  } else throw new Error(`Gabarit ${code} non traité par ce modèle`)
  // Source UNIQUE de la longueur de débit : les extrêmes du polygone.
  const rectangle=rectangleEnveloppant(verticesM)
  grossLengthM=rectangle.longueurBrute
  const gapD=expectedD===null ? 0 : D-expectedD
  const areaM2=surfacePolygone(verticesM)
  const grossAreaM2=grossLengthM*rectangle.profondeurBrute
  // Surface des chutes d'un rectangle brut ; ne présume pas de leur réemploi réel.
  const wasteAreaM2=Math.max(0,grossAreaM2-areaM2)
  return {
    areaM2,
    slopeLeftM, slopeRightM,
    horizontalLeftM:xS, horizontalRightM:xT,
    expectedD,
    gapD,
    coherent:Math.abs(gapD)<=GABARIT_TOLERANCE_M,
    grossLengthM,
    lengthBilledM:automaticBilledLength(code,{D,J,L,S,T}), // 11 et 21–24 automatiques selon règles confirmées
    angleLeftDegrees:leftAngle, angleRightDegrees:rightAngle,
    grossAreaM2,wasteAreaM2,
    verticesM,rectangleMinXM:rectangle.minX,rectangleMaxXM:rectangle.maxX,
  }
}

/** Encoches/décrochements 31–34 : cotes S/B horizontales, P verticale (selon plan à confirmer).
 * Contrairement à 21–24, S n'est pas ici une oblique.
 * Retourne le brut enveloppant et la surface de chute pour une coupe rectangulaire.
 */
export interface StepMeasures { D:number; J:number; L:number; P:number; S:number; B?:number }
export function geometryStep(code:string, m:StepMeasures) {
  if (!['31','32','33','34'].includes(code)) throw new Error('Type d’encoche inconnu')
  const {D,J,L,P,S,B}=m
  if (![D,J,L,P,S].every(v=>Number.isFinite(v)&&v>0&&v<=100)) throw new Error('Cotes D, J, L, P, S requises')
  if (!(P<L)) throw new Error('Profondeur de l’encoche P doit être inférieure à la largeur L')
  let areaM2:number, grossLengthM:number, expectedJ:number
  if (code==='31'||code==='32') {
    if (!Number.isFinite(B)||B!<0||B!+S>=D) throw new Error('Encoche : B + S doit être strictement inférieur à D')
    expectedJ=D
    grossLengthM=Math.max(D,J)
    areaM2=D*L-S*P
  } else {
    expectedJ=D+S
    grossLengthM=Math.max(D,J)
    areaM2=D*L+S*(L-P)
  }
  const gapJ=J-expectedJ
  const coherent=Math.abs(gapJ)<=GABARIT_TOLERANCE_M
  return {expectedJ,gapJ,coherent, grossLengthM,areaM2,
    grossAreaM2:grossLengthM*L,
    wasteAreaM2:Math.max(0,grossLengthM*L-areaM2)}
}

/**
 * Gabarits Richbond 41 et 51 : les quatre flancs K (hauts) et L (bas)
 * font OBLIGATOIREMENT 45° par rapport à l'horizontale, par symétrie.
 * 41 : H relie J au sommet supérieur (D=0, pointe haute).
 * 51 : H relie J à la ligne du dos D.
 * K et L désignent les longueurs réelles des côtés obliques, PAS leurs projections.
 *
 * Deux conséquences à 45° :
 *   H = W - (D + J)/2, donc W = H + (D + J)/2
 *   K = (W - D)/sqrt(2), L = (W - J)/sqrt(2).
 * Les données sont surdéterminées : les cotes K/L saisies doivent correspondre
 * aux longueurs calculées. Une tolérance de 5 mm accepte l'arrondi des mesures
 * en mètres, sans jamais assouplir l'angle de 45° du polygone construit.
 * La valeur W est seulement calculée, jamais une cote saisie.
 */
export interface PointesMeasures {J:number;D?:number;K:number;L:number;H:number}
export const POINTES_ANGLE_DEGREES = 45
export const POINTES_TOLERANCE_M = 0.005
export function geometryPointes(code:'41'|'51', m:PointesMeasures) {
  const {J,D,K,L,H}=m
  if (![J,K,L,H].every(v=>Number.isFinite(v)&&v>0&&v<=100))
    throw new Error(`Gabarit ${code} : J/K/L/H positifs obligatoires (m)`)
  if (code==='51' && (!Number.isFinite(D)||D!<=0||D!>100))
    throw new Error('Gabarit 51 : dos D obligatoire')
  const d=code==='41'?0:D!
  const W=H+(d+J)/2
  const horizontalK=(W-d)/2
  const horizontalL=(W-J)/2
  if (horizontalK<=0 || horizontalL<=0 || W>100) {
    throw new Error(`Gabarit ${code} : H/J/D incompatibles avec deux flancs à 45°`)
  }
  const expectedK=Math.SQRT2*horizontalK
  const expectedL=Math.SQRT2*horizontalL
  if (Math.abs(K-expectedK)>POINTES_TOLERANCE_M || Math.abs(L-expectedL)>POINTES_TOLERANCE_M) {
    throw new Error(`Gabarit ${code} : K/L/H/D/J incompatibles avec 45° (K attendu ${expectedK.toFixed(3)} m ; L attendu ${expectedL.toFixed(3)} m, tolérance ${POINTES_TOLERANCE_M*1000} mm)`)
  }
  const upperHeight=horizontalK
  const lowerHeight=horizontalL
  // Les coordonnées garantissent exactement 45° : |delta x| = |delta y|.
  const left:PointMetres={x:0,y:0},right:PointMetres={x:W,y:0}
  const points:PointMetres[]=code==='41'
    ? [left,{x:W/2,y:upperHeight},right,{x:(W+J)/2,y:-lowerHeight},{x:(W-J)/2,y:-lowerHeight}]
    : [left,{x:(W-d)/2,y:upperHeight},{x:(W+d)/2,y:upperHeight},right,{x:(W+J)/2,y:-lowerHeight},{x:(W-J)/2,y:-lowerHeight}]
  const box=rectangleEnveloppant(points)
  const areaM2=surfacePolygone(points)
  const grossAreaM2=box.longueurBrute*box.profondeurBrute
  const wasteAreaM2=Math.max(0,grossAreaM2-areaM2)
  return {
    verticesM:points, pointLeft:left,pointRight:right,
    distancePointesM:W,brutM:box.longueurBrute,
    angleKDeg:POINTES_ANGLE_DEGREES,angleLDeg:POINTES_ANGLE_DEGREES,
    hauteurSaisieM:H,hauteurCalculeeM:upperHeight+lowerHeight,
    hauteurHautM:upperHeight,hauteurBasM:lowerHeight,
    projectionK:horizontalK,projectionL:horizontalL,
    coteKTheoriqueM:expectedK,coteLTheoriqueM:expectedL,
    profondeurBruteM:box.profondeurBrute,areaM2,grossAreaM2,wasteAreaM2,
    coherent:Math.abs(expectedK-K)<=POINTES_TOLERANCE_M && Math.abs(expectedL-L)<=POINTES_TOLERANCE_M,
  }
}

/**
 * Règles de facturation confirmées par l'atelier pour 21/22 et 31..34.
 * Indépendantes des contrôles géométriques et des estimations de chute.
 * La valeur est exprimée en mètres linéaires.
 */
export function automaticBilledLength(code:string, measures:{D?:number; J?:number; L?:number; S?:number; T?:number; K?:number; H?:number}):number|null {
  if (!['11','21','22','23','24','31','32','33','34','41','51'].includes(code)) return null
  const { D, J, S, T, L, K, H }=measures
  if (code==='11') {
    if (!Number.isFinite(D) || D! <= 0 || D! > 1000) throw new Error('Gabarit 11 : dos D positif obligatoire')
    return D!
  }
  if (code==='41'||code==='51') {
    return geometryPointes(code,{D,J:J!,K:K!,L:L!,H:H!}).distancePointesM
  }
  if (!Number.isFinite(J)||J!<=0||J!>1000) throw new Error(`Gabarit ${code} : assise J positive obligatoire`)
  if (['21','22'].includes(code)) {
    if (!Number.isFinite(D)||D!<=0||D!>1000) throw new Error(`Gabarit ${code} : dos D positif obligatoire`)
    return Math.max(D!,J!)
  }
  if (code==='23'||code==='24') {
    if (!Number.isFinite(L)||L!<=0||L!>100) throw new Error(`Gabarit ${code} : largeur article L obligatoire`)
    const oblique=code==='23'?T:S
    if (!Number.isFinite(oblique)||oblique!<L!||oblique!>100) throw new Error(`Gabarit ${code} : oblique ${code==='23'?'T':'S'} invalide`)
    const projection=Math.sqrt(Math.max(0,oblique!*oblique!-L!*L!))
    return J!+projection
  }
  return J!
}
