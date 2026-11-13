import { z } from "zod"
import { GABARIT_CODES } from "@/lib/gabarits"
import { SHAPES } from "@/lib/order-pieces"

const shape = z.enum(SHAPES)
const dims = z.object({
  lengthCm: z.number().positive().max(1500),
  widthCm: z.number().positive().max(1500),
  heightCm: z.number().positive().max(1500),
})
const part = dims.extend({
  label: z.string().trim().min(1).max(150),
  partRef: z.string().trim().min(1).max(40).optional(),
  linearMeters: z.number().positive().max(1000).optional(),
  gabaritCode: z.enum(GABARIT_CODES).optional(),
  billingMode: z.enum(["manual", "computed"]).optional(),
  shape,
  count: z.number().int().min(1).max(50),
  extra: z.record(z.string(), z.number().positive().max(1500)).optional(),
  note: z.string().max(300).optional(),
})
const foamLayer = z.object({
  nature: z.enum(["PURE","AGGLO"]),
  densityKgM3: z.number().gt(0).max(500),
  thicknessCm: z.number().gt(0).max(1500),
}).strict()
export const GenericLineSchema = z.object({
  template: z.enum(["GEN-MAT","GEN-MOU","GEN-SAL","GEN-DIV"]),
  description: z.string().trim().min(5).max(200),
  specifications: z.string().trim().min(12).max(2000),
  lengthCm: z.number().positive().max(1500).optional(),
  widthCm: z.number().positive().max(1500).optional(),
  heightCm: z.number().positive().max(1500).optional(),
  requiresPreparation: z.boolean().default(true),
  // D-GEN-01 (option D) : champs taxonomiques réels, validés AVANT l'insertion
  // pour produire un 400 explicite au lieu de l'aborton 503 du trigger V16.
  coreType: z.enum(["SANS_RESSORTS","BONNELL","ENSACHES"]).optional(),
  foamComposition: z.enum(["PURE","MELANGE","AGGLO"]).optional(),
  mattressFinish: z.enum(["SANS","TOPPER","ALESE"]).optional(),
  foamNature: z.enum(["PURE","AGGLO"]).optional(),
  foamDensity: z.number().gt(0).max(500).optional(),
  foamGrade: z.string().trim().min(2).max(80).optional(),
  foamLayers: z.array(foamLayer).min(1).max(8).optional(),
}).strict().superRefine((g,ctx)=>{
  const count=[g.lengthCm,g.widthCm,g.heightCm].filter(v=>v!==undefined).length
  if(g.template!=="GEN-DIV" && count!==3)ctx.addIssue({code:"custom",message:"Trois dimensions obligatoires pour ce modèle"})
  if(g.template==="GEN-DIV" && count!==0 && count!==3)ctx.addIssue({code:"custom",message:"GEN-DIV : saisir les trois dimensions ou aucune"})
  // D-GEN-01 : validation alignée sur go_v16_product_insert — aucun contournement du trigger.
  const taxFields=[g.coreType,g.foamComposition,g.mattressFinish,g.foamNature,g.foamDensity,g.foamGrade,g.foamLayers]
  const taxPresent=taxFields.some(v=>v!==undefined)
  if(g.template==="GEN-DIV"){
    // Famille DIVERS absente de la taxonomie V16 : parcours suspendu en
    // attendant la décision métier SODEPI (D-GEN-01/E) — refus explicite 400,
    // plus jamais l'aborton 503 trompeur du trigger.
    ctx.addIssue({code:"custom",message:"GEN-DIV suspendu : famille DIVERS absente de la taxonomie V16 (décision métier SODEPI requise, D-GEN-01/E)"})
    if(taxPresent)ctx.addIssue({code:"custom",message:"GEN-DIV n'accepte aucun champ taxonomique"})
  }
  if(g.template==="GEN-SAL" && taxPresent)
    ctx.addIssue({code:"custom",message:"GEN-SAL n'accepte aucun champ taxonomique (famille SALON sans contraintes techniques)"})
  if(g.template==="GEN-MAT"){
    if(!g.coreType)ctx.addIssue({code:"custom",message:"GEN-MAT : type de noyau obligatoire (SANS_RESSORTS, BONNELL ou ENSACHES)"})
    if(!g.foamComposition)ctx.addIssue({code:"custom",message:"GEN-MAT : composition mousse obligatoire (PURE, MELANGE ou AGGLO)"})
    if(!g.mattressFinish)ctx.addIssue({code:"custom",message:"GEN-MAT : finition obligatoire (SANS, TOPPER ou ALESE)"})
    if(g.foamNature!==undefined)ctx.addIssue({code:"custom",message:"GEN-MAT : nature mousse interdite (réservée à PLAQUE_MOUSSE)"})
    if(g.foamGrade!==undefined)ctx.addIssue({code:"custom",message:"GEN-MAT : grade mousse interdit (réservé à PLAQUE_MOUSSE)"})
    if(g.foamComposition==="PURE"||g.foamComposition==="AGGLO"){
      if(g.foamDensity===undefined)ctx.addIssue({code:"custom",message:"GEN-MAT : densité de mousse obligatoire (kg/m³, 1–500)"})
      if(g.foamLayers!==undefined)ctx.addIssue({code:"custom",message:"GEN-MAT : couches interdites pour une composition PURE ou AGGLO"})
    }
    if(g.foamComposition==="MELANGE"){
      if(g.foamDensity!==undefined)ctx.addIssue({code:"custom",message:"GEN-MAT : densité globale interdite pour un MELANGE (couches obligatoires)"})
      if(!g.foamLayers||g.foamLayers.length<2)ctx.addIssue({code:"custom",message:"GEN-MAT : MELANGE exige au moins deux couches physiques"})
      if(g.foamLayers){
        if(!g.foamLayers.some(l=>l.nature==="PURE")||!g.foamLayers.some(l=>l.nature==="AGGLO"))
          ctx.addIssue({code:"custom",message:"GEN-MAT : MELANGE exige au moins une couche PURE et une couche AGGLO"})
        const total=g.foamLayers.reduce((s,l)=>s+l.thicknessCm,0)
        if(g.heightCm!==undefined && total>g.heightCm+0.001)
          ctx.addIssue({code:"custom",message:"GEN-MAT : épaisseur totale des couches supérieure à la hauteur du matelas"})
      }
    }
  }
  if(g.template==="GEN-MOU"){
    if(!g.foamNature)ctx.addIssue({code:"custom",message:"GEN-MOU : nature obligatoire (PURE ou AGGLO)"})
    if(g.foamDensity===undefined)ctx.addIssue({code:"custom",message:"GEN-MOU : densité obligatoire (kg/m³, 1–500)"})
    if(!g.foamGrade)ctx.addIssue({code:"custom",message:"GEN-MOU : grade/qualité obligatoire (2 caractères minimum)"})
    if(g.coreType!==undefined||g.foamComposition!==undefined||g.mattressFinish!==undefined||g.foamLayers!==undefined)
      ctx.addIssue({code:"custom",message:"GEN-MOU : noyau, composition, finition et couches interdits (famille PLAQUE_MOUSSE)"})
  }
})
// BTS-03 (audit R9 indépendant) : Zod 4 interdit .omit() sur un schéma portant
// des refinements. Base "pure" pour permettre l'omission de quoteId (rejeu de
// devis) SANS perdre la validation des sentinelles de lignes génériques.
const OrderCreateObject = z.object({
  clientId: z.number().int().positive(),
  dueDate: z.string().datetime(),
  priority: z.enum(["normale", "haute"]).default("normale"),
  note: z.string().max(300).optional().nullable(),
  customerOrderNo: z.string().trim().max(80).optional().nullable(),
  quoteId: z.number().int().positive().optional(),
  lines: z.array(z.object({
    // -1,-2,... : sentinelles du formulaire ; aucune FK négative persistée.
    productId: z.number().int().min(-100).refine(n=>n!==0),
    generic: GenericLineSchema.optional(),
    qty: z.number().positive().max(10000),
    unitPrice: z.number().min(0).max(100000000),
    technicalInstructions: z.string().trim().max(1200).optional().nullable(),
    modelRef: z.string().max(80).optional().nullable(),
    configRef: z.string().max(80).optional().nullable(),
    dimensions: dims.optional(),
    shape: shape.optional(),
    extra: z.record(z.string(), z.number().positive().max(1500)).optional(),
    pieceCount: z.number().int().min(1).max(50).optional(),
    ensembleCount: z.number().int().min(1).max(50).optional(),
    parts: z.array(part).max(50).optional(),
  }).superRefine((l,ctx)=>{
    if(l.productId<0 && !l.generic)ctx.addIssue({code:"custom",message:"Configuration générique obligatoire"})
    if(l.productId>0 && l.generic)ctx.addIssue({code:"custom",message:"Une référence catalogue ne peut pas être un gabarit générique"})
    if(l.generic && l.unitPrice<=0)ctx.addIssue({code:"custom",message:"Prix spécifique générique positif obligatoire"})
  })).min(1).max(100),
})

const orderSentinelRefine=(order:{lines:{productId:number}[]},ctx:z.RefinementCtx)=>{
  const sentinels=new Set<number>()
  for(const [index,l] of order.lines.entries())if(l.productId<0){
    if(sentinels.has(l.productId))ctx.addIssue({code:"custom",path:["lines",index,"productId"],message:"Chaque ligne générique exige un identifiant de saisie propre"})
    sentinels.add(l.productId)
  }
}

export const OrderCreateSchema = OrderCreateObject.superRefine(orderSentinelRefine)
// Variante sans quoteId, mêmes validations métier, pour /api/sales.
export const OrderCreateWithoutQuoteIdSchema = OrderCreateObject.omit({quoteId:true}).superRefine(orderSentinelRefine)

