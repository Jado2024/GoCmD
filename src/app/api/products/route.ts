import { safeErrorMetadata } from "@/lib/safe-server-error"
import { accessGate, currentActor, isDirector, hasRole, hasPermission } from "@/lib/access-gate"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { PRODUCT_FAMILIES, unitForFamily, validateTechnicalSpecs } from "@/lib/product-taxonomy"
import { productDtoForActor } from "@/lib/product-dto"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { fixedProductIdentity } from "@/lib/fixed-product-identity"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 24

export async function GET(req: NextRequest) {
  const denied = accessGate(req)
  if (denied) return denied





  const sp = req.nextUrl.searchParams
  const q = (sp.get("q") ?? "").trim()
  const family = sp.get("family") ?? ""
  const model = sp.get("model") ?? ""
  const variant = sp.get("variant") ?? ""
  const subCategory = sp.get("subCategory") ?? ""
  const coreType = sp.get("coreType") ?? ""
  const foamComposition = sp.get("foamComposition") ?? ""
  const foamNature = sp.get("foamNature") ?? ""
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1)
  const wantFacets = sp.get("facets") === "1"
  if(sp.get("pendingPrice")==="1"){
    // C4-R2 : le rôle directeur ne suffit pas lorsqu'une autorisation tarifaire
    // individuelle a été révoquée (y compris sur la file en lecture seule).
    if(!isDirector(req) || !hasPermission(req,"director.prices"))
      return NextResponse.json({error:"Liste des prix réservée au directeur habilité (director.prices)"},{status:403})
    const queuePage=Number(sp.get("page")??1)
    const queuePageSize=Number(sp.get("pageSize")??25)
    if(!Number.isSafeInteger(queuePage)||queuePage<1||queuePage>1_000_000||
       !Number.isSafeInteger(queuePageSize)||queuePageSize<1||queuePageSize>100)
      return NextResponse.json({error:"Pagination des prix spéciaux invalide"},{status:400})
    const where={specialPriceStatus:"pending",status:"pending_validation",specialNotes:{not:null},isOrderScoped:false} as const
    const [total,items]=await Promise.all([
      db.product.count({where}),
      db.product.findMany({where,orderBy:[{createdAt:"asc"},{id:"asc"}],skip:(queuePage-1)*queuePageSize,take:queuePageSize}),
    ])
    return NextResponse.json({items,total,page:queuePage,pageSize:queuePageSize,pages:Math.max(1,Math.ceil(total/queuePageSize))},
      {headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}})
  }

  if (wantFacets) {
    const rows = await db.product.findMany({
      select: { family: true, model: true, variant: true, subCategory: true, coreType: true, foamComposition: true, foamNature: true },
      distinct: ["family", "model", "variant", "subCategory", "coreType", "foamComposition", "foamNature"],
      where: {status:"active",isOrderScoped:false},
    })
    const tree = new Map<string, Set<string>>()
    const variantsByFamily = new Map<string, Set<string>>()
    const subCategoriesByFamily = new Map<string, Set<string>>()
    const coresByFamily = new Map<string, Set<string>>()
    const foamsByFamily = new Map<string, Set<string>>()
    const naturesByFamily = new Map<string, Set<string>>()
    for (const r of rows) {
      if (!tree.has(r.family)) tree.set(r.family, new Set())
      tree.get(r.family)!.add(r.model)
      if (!variantsByFamily.has(r.family)) variantsByFamily.set(r.family, new Set())
      variantsByFamily.get(r.family)!.add(r.variant)
      if (r.coreType) {if (!coresByFamily.has(r.family)) coresByFamily.set(r.family,new Set());coresByFamily.get(r.family)!.add(r.coreType)}
      if (r.foamComposition) {if (!foamsByFamily.has(r.family)) foamsByFamily.set(r.family,new Set());foamsByFamily.get(r.family)!.add(r.foamComposition)}
      if (r.foamNature) {if (!naturesByFamily.has(r.family)) naturesByFamily.set(r.family,new Set());naturesByFamily.get(r.family)!.add(r.foamNature)}
      if (r.subCategory) {
        if (!subCategoriesByFamily.has(r.family)) subCategoriesByFamily.set(r.family, new Set())
        subCategoriesByFamily.get(r.family)!.add(r.subCategory)
      }
    }
    return NextResponse.json({
      families: [...tree.entries()].map(([f, mods]) => ({
        family: f,
        models: [...mods].sort(),
        variants: [...(variantsByFamily.get(f) ?? [])].sort(),
        subCategories: [...(subCategoriesByFamily.get(f) ?? [])].sort(),
        coreTypes: [...(coresByFamily.get(f) ?? [])].sort(),
        foamCompositions: [...(foamsByFamily.get(f) ?? [])].sort(),
        foamNatures: [...(naturesByFamily.get(f) ?? [])].sort(),
      })),
    })
  }

  const where = {
    AND: [
      {isOrderScoped:false},
      // Un commercial peut réutiliser dans son devis une proposition spéciale
      // dont le PRIX a été autorisé par le directeur, même si l'approbation
      // technique de commande n'est pas encore faite.
      hasRole(req,"sales") ? {OR:[{status:"active"},{status:"pending_validation",specialPriceStatus:"approved"}]} : {status:"active"},
      family ? { family } : {},
      model ? { model } : {},
      variant ? { variant } : {},
      subCategory ? { subCategory } : {},
      coreType ? { coreType } : {},
      foamComposition ? { foamComposition } : {},
      foamNature ? { foamNature } : {},
      q
        ? {
            OR: [
              { name: { contains: q } },
              { sku: { contains: q } },
              { model: { contains: q } },
              { commercialAbbreviation: { contains: q } },
              { commercialBrand: { contains: q } },
              { actualManufacturer: { contains: q } },
            ],
          }
        : {},
    ],
  }

  const [total, items] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: [{ family: "asc" }, { model: "asc" }, { variant: "asc" }, { width: "asc" }, { height: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ])

  // V18.9.9 (SEC-PROD-01) : DTO explicite par permission — les notes internes
  // et métadonnées d'approbation ne sortent jamais vers un rôle non habilité.
  const actor = currentActor(req)
  return NextResponse.json({
    items: items.map(p => productDtoForActor(p, actor)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    pageSize: PAGE_SIZE,
  })
}

/** Une référence inconnue reste provisoire jusqu'à validation de sa commande. */
import { z } from "zod"

const CreateProductSchema = z.object({
  model: z.string().trim().min(2).max(120),
  family: z.enum(PRODUCT_FAMILIES),
  length: z.number().int().positive().max(1500),
  width: z.number().int().positive().max(1500),
  height: z.number().int().positive().max(1500),
  unitPrice: z.number().positive().max(100000000).refine(v=>Math.abs(v*100-Math.round(v*100))<1e-6,{message:"Prix en MAD : deux décimales maximum"}),
  subCategory: z.string().trim().min(2).max(80),
  similarProductId: z.number().int().positive().optional(),
  specialNotes: z.string().trim().min(15).max(2000),
  commercialAbbreviation: z.string().trim().max(24).optional(),
  commercialBrand: z.string().trim().max(120).optional(),
  actualManufacturer: z.string().trim().max(120).optional(),
  descriptionOverride: z.string().trim().max(200).optional(),
  coreType: z.enum(["SANS_RESSORTS", "BONNELL", "ENSACHES"]).optional(),
  foamComposition: z.enum(["PURE", "MELANGE", "AGGLO"]).optional(),
  mattressFinish: z.enum(["SANS", "TOPPER", "ALESE"]).optional(),
  upholstery: z.enum(["NUE", "TISSU"]).optional(),
  foamNature: z.enum(["PURE", "AGGLO"]).optional(),
  foamGrade: z.string().trim().max(80).optional(),
  foamDensity: z.number().positive().max(500).optional(),
  foamLayers: z.string().max(5000).optional(),
}).strict()
export async function POST(req:NextRequest){
  const denied = accessGate(req,"sales")
  if (denied) return denied
  const parsed=CreateProductSchema.safeParse(await req.json().catch(()=>null))
  if(!parsed.success) return NextResponse.json({error:"Fiche du produit spécial incomplète",details:parsed.error.flatten()},{status:400})
  const data=parsed.data
  const technicalError = validateTechnicalSpecs(data)
  if (technicalError) return NextResponse.json({error:technicalError},{status:400})
  let similarSku:string|null=null
  if(data.similarProductId){
    const similar=await db.product.findFirst({where:{id:data.similarProductId,status:"active"}})
    if(!similar || similar.family!==data.family) return NextResponse.json({error:"Le produit proche doit être validé et appartenir à la même famille"},{status:400})
    similarSku=similar.sku
  }
  const unit = unitForFamily(data.family)
  // Une référence fixe est une vraie variante gouvernée, pas un UUID aléatoire.
  const coded=fixedProductIdentity({...data,variant:"STD"})
  const sku=coded.sku
  try {
    // P5.15.21 (CONC-002) : création de référence — mutation sensible passée
    // dans la file d'écriture sérialisée (avec avance/approbation de commande
    // et PATCH référence, elles étaient les quatre mutations hors file).
    const product=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
      const duplicate=await tx.product.findUnique({where:{canonicalIdentity:coded.identity},select:{id:true,sku:true}})
      if(duplicate)throw Error("DUPLICATE_PF_IDENTITY")
      const created=await tx.product.create({data:{...data,similarProductSku:similarSku,
        canonicalIdentity:coded.identity,technicalAttributesJson:JSON.stringify(coded.attributes),
        specialPriceStatus:"pending",specialPriceRevision:1,specialPriceProposedBy:currentActor(req)!.username,
        sku,variant:"STD",unit,status:"pending_validation",
        name:data.descriptionOverride?.trim() || (data.family === "OUATE" ? `OUATE ${data.model} (kg)` : `${data.family} ${data.model} ${data.length}×${data.width}×${data.height}`)}})
      await tx.auditEvent.create({data:{actor:currentActor(req)!.username,action:"SPECIAL_PRICE_PROPOSED",entity:"Product",entityId:String(created.id),details:JSON.stringify({price:created.unitPrice,revision:1,sku:created.sku})}})
      return created
    }))
    return NextResponse.json({product: productDtoForActor(product, currentActor(req))},{status:201})
  }catch(e){
    if(e instanceof Error&&e.message==="DUPLICATE_PF_IDENTITY")return NextResponse.json({error:"Cette variante technique existe déjà : rechercher sa référence fixe avant de créer un doublon",code:"DUPLICATE_PF_IDENTITY"},{status:409})
    console.error("Création provisoire échouée",safeErrorMetadata(e));return NextResponse.json({error:"Référence déjà existante ou création provisoire impossible"},{status:409})
  }
}
