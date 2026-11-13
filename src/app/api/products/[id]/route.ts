import { accessGate, currentActor } from "@/lib/access-gate"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { unitForFamily, validateTechnicalSpecs } from "@/lib/product-taxonomy"
import { mayReadNonActiveProduct, productDtoForActor } from "@/lib/product-dto"
import { isValidStockQuantity } from "@/lib/stock-quantity"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"

export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = accessGate(_req)
  if (denied) return denied





  const { id } = await ctx.params
  const pid = Number(id)
  if (!Number.isInteger(pid)) {
    return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 })
  }
  const product = await db.product.findUnique({ where: { id: pid } })
  if (!product || product.isOrderScoped) {
    return NextResponse.json({ error: "Produit introuvable" }, { status: 404 })
  }
  // V18.9.9 (SEC-PROD-02) : les propositions en attente ou refusées ne sont
  // accessibles ni par énumération d'identifiant ni par différence de
  // réponse. Un rôle non concerné reçoit le même 404 qu'un identifiant
  // inexistant : l'existence d'une proposition confidentielle n'est pas
  // confirmée. Le directeur, l'admin et le commercial concerné conservent
  // l'accès ; un autre commercial ne voit qu'une proposition déjà visée
  // tarifairement (réutilisable en commande, comme dans la liste catalogue).
  const actor = currentActor(_req)
  if (product.status !== "active" && !mayReadNonActiveProduct(actor, product)) {
    return NextResponse.json({ error: "Produit introuvable" }, { status: 404 })
  }
  // V18.9.9 (SEC-PROD-01) : DTO par permission — jamais de notes internes ni
  // de métadonnées d'approbation vers un rôle non habilité, même actif.
  return NextResponse.json(productDtoForActor(product, actor))
}

const PatchSchema = z.object({
  unitPrice: z.number().min(0).optional(),
  minStock: z.number().finite().min(0).max(1e9).optional(),
  targetStock: z.number().finite().min(0).max(1e9).nullable().optional(),
  unit: z.enum(["ml", "u", "kg"]).optional(),
  commercialAbbreviation:z.string().trim().max(24).nullable().optional(),
  commercialBrand:z.string().trim().max(120).nullable().optional(),
  actualManufacturer:z.string().trim().max(120).nullable().optional(),
  descriptionOverride:z.string().trim().max(200).nullable().optional(),
  reason:z.string().trim().min(8).max(500),
  coreType:z.enum(["SANS_RESSORTS","BONNELL","ENSACHES"]).nullable().optional(),
  foamComposition:z.enum(["PURE","MELANGE","AGGLO"]).nullable().optional(),
  mattressFinish:z.enum(["SANS","TOPPER","ALESE"]).nullable().optional(),
  upholstery:z.enum(["NUE","TISSU"]).nullable().optional(),
  foamNature:z.enum(["PURE","AGGLO"]).nullable().optional(),
  foamGrade:z.string().trim().max(80).nullable().optional(),
  foamDensity:z.number().positive().max(500).nullable().optional(),
  foamLayers:z.string().max(5000).nullable().optional(),
})

/**
 * PATCH /api/products/[id]  { unitPrice?, unit? }
 * Saisie manuelle du prix de vente indicatif et de l'unité de vente.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = accessGate(req,"approver")
  if (denied) return denied





  const { id } = await ctx.params
  const pid = Number(id)
  if (!Number.isInteger(pid)) {
    return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  const technicalKeys = ["coreType","foamComposition","mattressFinish","upholstery","foamNature","foamGrade","foamDensity","foamLayers"] as const
  const commercialKeys = ["commercialAbbreviation","commercialBrand","actualManufacturer","descriptionOverride"] as const
  if (!parsed.success || (parsed.data.unitPrice == null && parsed.data.unit == null && parsed.data.minStock===undefined && parsed.data.targetStock===undefined && !technicalKeys.some(k => parsed.data?.[k] !== undefined) && !commercialKeys.some(k => parsed.data?.[k] !== undefined))) {
    return NextResponse.json(
      { error: "Corps invalide — fournir unitPrice et/ou unit (ml|u|kg) ou informations commerciales" },
      { status: 400 },
    )
  }

  const existing = await db.product.findUnique({ where: { id: pid } })
  if (!existing) return NextResponse.json({ error: "Produit introuvable" }, { status: 404 })
  // V2 : une fiche générique de ligne n'est jamais éditable comme fiche catalogue.
  if(existing.isOrderScoped)return NextResponse.json({error:"Fiche technique propre à une commande : modification interdite"},{status:409})
  // Tous les attributs identitaires d'une référence fixe V2 sont immuables ;
  // une correction technique se fait par une nouvelle variante/révision liée.
  if(existing.canonicalIdentity && technicalKeys.some(k=>parsed.data[k]!==undefined))
    return NextResponse.json({error:"Identité technique V2 figée : créer une nouvelle variante avec lien de révision"},{status:409})
  if(technicalKeys.some(k=>parsed.data[k]!==undefined)) {
    const used=await db.orderLine.findFirst({where:{productId:pid},select:{id:true}})
    if(used)return NextResponse.json({error:"Référence déjà utilisée : créer une nouvelle variante technique"},{status:409})
  }
  if(existing.materialId!=null && (parsed.data.unit!==undefined || parsed.data.unitPrice!==undefined || parsed.data.minStock!==undefined || parsed.data.targetStock!==undefined || technicalKeys.some(k=>parsed.data[k]!==undefined)))
    return NextResponse.json({error:"Article lié au stock : modifier unité et prix depuis sa fiche article"},{status:409})

  // Un prix catalogue normal doit faire l’objet d’une proposition suivie du visa directeur.
  if(parsed.data.unitPrice!==undefined && Math.abs(parsed.data.unitPrice-existing.unitPrice)>0.00001)
    return NextResponse.json({error:"Prix catalogue : deposer une proposition puis obtenir le visa du directeur via /api/products/[id]/catalog-price"},{status:409})
  const nextMinimum=parsed.data.minStock??existing.minStock
  const nextTarget=parsed.data.targetStock===undefined ? existing.targetStock : parsed.data.targetStock
  if((nextTarget??nextMinimum)<nextMinimum || !isValidStockQuantity(nextMinimum,existing.unit,true) || !isValidStockQuantity(nextTarget??nextMinimum,existing.unit,true))
    return NextResponse.json({error:"Seuil/cible incompatibles avec l unite de stock"},{status:400})
  // Les prix spéciaux passent UNIQUEMENT par le circuit directeur, pas par le
  // PATCH catalogue de l'approbateur (même si admin).
  if(existing.specialNotes && parsed.data.unitPrice !== undefined)
    return NextResponse.json({error:"Prix spécial : utiliser la proposition tarifaire, puis la validation explicite du directeur"},{status:409})
  if(existing.specialNotes && existing.specialPriceStatus==="approved" && technicalKeys.some(k=>parsed.data[k]!==undefined))
    return NextResponse.json({error:"Fiche technique liée à un tarif déjà approuvé : créer une nouvelle référence spéciale ou demander une nouvelle étude tarifaire"},{status:409})
  const requiredUnit = unitForFamily(existing.family)
  const nextSpecs = {...existing, ...Object.fromEntries(technicalKeys.filter(k=>parsed.data[k]!==undefined).map(k=>[k,parsed.data[k]]))}
  const technicalError=validateTechnicalSpecs(nextSpecs)
  if (technicalError) return NextResponse.json({error:technicalError},{status:400})
  if (parsed.data.unit != null && parsed.data.unit !== requiredUnit) {
    return NextResponse.json({error:`Unité imposée pour ${existing.family} : ${requiredUnit}`},{status:400})
  }
  // P5.15.21 (CONC-002) : modification de référence — mutation sensible
  // passée dans la file d'écriture sérialisée.
  const product = await serializedSQLiteWrite(()=>db.$transaction(async tx => {
    const updated=await tx.product.update({
    where: { id: pid },
    data: {
      ...(parsed.data.minStock!==undefined?{minStock:parsed.data.minStock}:{}),
      ...(parsed.data.targetStock!==undefined?{targetStock:parsed.data.targetStock}:{}),
      ...(parsed.data.unit != null ? { unit: parsed.data.unit } : {}),
      ...Object.fromEntries(technicalKeys.filter(k=>parsed.data[k]!==undefined).map(k=>[k,parsed.data[k]])),
      ...Object.fromEntries(commercialKeys.filter(k=>parsed.data[k]!==undefined).map(k=>[k,parsed.data[k]])),
      ...(parsed.data.descriptionOverride !== undefined ? {name:parsed.data.descriptionOverride?.trim() || existing.name} : {}),
    },
    })
    await tx.auditEvent.create({data:{actor:currentActor(req)!.username,action:"PRODUCT_UPDATED",entity:"Product",entityId:String(pid),details:JSON.stringify({reason:parsed.data.reason,before:{unitPrice:existing.unitPrice,unit:existing.unit,...Object.fromEntries([...technicalKeys,...commercialKeys].map(k=>[k,existing[k]]))},after:{unitPrice:updated.unitPrice,unit:updated.unit,...Object.fromEntries([...technicalKeys,...commercialKeys].map(k=>[k,updated[k]]))}})}})
    return updated
  }))
  // V18.9.9 (SEC-PROD-01) : la réponse PATCH suit le même DTO par permission.
  return NextResponse.json(productDtoForActor(product, currentActor(req)))
}
