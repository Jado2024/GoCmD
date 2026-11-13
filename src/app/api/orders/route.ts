import { createHash } from "node:crypto"
import { genericVirtualProduct, genericLineSnapshot, catalogLineSnapshot, snapshotHash } from "@/lib/generic-order"
import { lookupOrderDuplicates, duplicateConflict, DuplicateReviewSchema, normalizeCustomerOrderNo } from "@/lib/order-duplicate"
import { safeErrorMetadata } from "@/lib/safe-server-error"
import { accessGate, currentActor, hasPermission } from "@/lib/access-gate"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { nextRef } from "@/lib/erp-server"
import { unitForFamily,validateTechnicalSpecs } from "@/lib/product-taxonomy"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { buildPieces } from "@/lib/order-pieces"
import { OrderCreateSchema } from "@/lib/order-create-schema"
import { readQuoteVisas, quoteLineVisaValid, quoteReviewPlan, type QuotePricePlan } from "@/lib/quote-line-prices"
import { isSameAuthorizedPrice } from "@/lib/special-price"
import { hasPriceException, hasTechnicalException, validatedOrderStatus } from "@/lib/commercial-authorization"
import {stockForSale} from "@/lib/article-trade"
import { productDtoForActor } from "@/lib/product-dto"

export const dynamic = "force-dynamic"

class DuplicateOrderConflict extends Error {
  constructor(readonly response: Record<string, unknown>) {
    super(String(response.error ?? "Commande potentiellement en doublon"))
  }
}



const include = { client: true, lines: { include: { product: true, pieces: { orderBy: { sequence: "asc" as const } } } } } as const

function orderResponse(o: import("@prisma/client").Prisma.OrderGetPayload<{include: typeof include}>, actor: ReturnType<typeof currentActor>) {
  const {createRequestKey: internalKey,createRequestDigest: internalDigest,customerOrderNoNormalized: internalNormalized,...safeOrder}=o
  void internalKey; void internalDigest; void internalNormalized
  return {
    ...safeOrder, dueDate: o.dueDate?.toISOString() ?? null, createdAt: o.createdAt.toISOString(),
    lines: o.lines.map(l => ({ ...l, product: productDtoForActor(l.product, actor) })),
    total: o.lines.reduce((t, l) => t + l.qty * l.unitPrice, 0),
  }
}

export async function GET(req: NextRequest) {
  const denied = accessGate(req)
  if (denied) return denied
  // Les commandes contiennent tarifs et coordonnées clients : lecture réservée
  // aux rôles commercial, approbateur, finance et direction.
  // Un compte démo partagé ne donne aucun droit aux données clients.
  const actor=currentActor(req)
  const mayRead=actor&&!actor.legacy&&actor.roles.some(r=>["sales","approver","finance","director"].includes(r)) &&
    (!actor.managed || hasPermission(req,"clients.read"))
  if(!mayRead)return NextResponse.json({error:"Lecture des commandes réservée aux rôles habilités"},{status:403})
  const params=req.nextUrl.searchParams
  const take=Number(params.get("take")??50)
  const skip=Number(params.get("skip")??0)
  const q=(params.get("q")??"").trim()
  if(!Number.isSafeInteger(take)||take<1||take>200||!Number.isSafeInteger(skip)||skip<0||skip>10_000_000||q.length>100)
    return NextResponse.json({error:"Pagination ou recherche de commandes invalide"},{status:400})
  const where:import("@prisma/client").Prisma.OrderWhereInput=q?{OR:[
    {ref:{contains:q}}, {client:{name:{contains:q}}},
  ]}:{}
  // Les indicateurs sont calculés sur TOUTES les commandes autorisées, jamais sur la page courante.
  // Agrégation SQLite fixe (sans interpolation utilisateur) pour éviter le chargement des lignes en mémoire.
  // R11 PERF-01 : lecture compacte opt-in pour le tableau. Aucun changement
  // du contrat historique GET sans view=list ; les objets et tarifs détaillés
  // restent chargés depuis GET /api/orders/[id] avec les mêmes droits RBAC.
  // Les informations globales restent calculées en base, jamais sur la page.
  if (params.get("view")==="list") {
    const [total,orders,globalTotal,late,portfolioRows]=await Promise.all([
      db.order.count({where}),
      db.order.findMany({where,select:{
        id:true,ref:true,status:true,priority:true,dueDate:true,createdAt:true,
        client:{select:{id:true,name:true,city:true}},
        lines:{select:{qty:true,unitPrice:true}},
      },orderBy:[{createdAt:"desc"},{id:"desc"}],take,skip}),
      db.order.count(),
      db.order.count({where:{status:{in:["new","production","ready"]},fulfillmentStatus:"open",dueDate:{lt:new Date()}}}),
      db.$queryRaw<{portfolio:number|null}[]>`SELECT SUM(l."qty" * l."unitPrice") AS portfolio
        FROM "OrderLine" l INNER JOIN "Order" o ON o."id" = l."orderId" WHERE o."status" IN ('new','production','ready') AND o."fulfillmentStatus" = 'open'`,
    ])
    return NextResponse.json({
      items:orders.map(o=>({id:o.id,ref:o.ref,status:o.status,priority:o.priority,
        dueDate:o.dueDate?.toISOString()??null,createdAt:o.createdAt.toISOString(),
        client:o.client,lineCount:o.lines.length,
        total:o.lines.reduce((sum,l)=>sum+l.qty*l.unitPrice,0)})),
      pagination:{total,skip,take,hasMore:skip+orders.length<total},
      summary:{total:globalTotal,late,portfolio:Number(portfolioRows[0]?.portfolio??0)},
    },{headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}})
  }
  const [total,orders,globalTotal,late,portfolioRows]=await Promise.all([
    db.order.count({where}),
    db.order.findMany({where,include,orderBy:[{createdAt:"desc"},{id:"desc"}],take,skip}),
    db.order.count(),
    db.order.count({where:{status:{in:["new","production","ready"]},fulfillmentStatus:"open",dueDate:{lt:new Date()}}}),
    db.$queryRaw<{portfolio:number|null}[]>`SELECT SUM(l."qty" * l."unitPrice") AS portfolio
      FROM "OrderLine" l INNER JOIN "Order" o ON o."id" = l."orderId" WHERE o."status" IN ('new','production','ready') AND o."fulfillmentStatus" = 'open'`,
  ])
  // V18.9.9 (SEC-PROD-01) : DTO produit par permission dans les imbrications.
  return NextResponse.json({items:orders.map(o=>orderResponse(o,actor)),pagination:{total,skip,take,hasMore:skip+orders.length<total},summary:{total:globalTotal,late,portfolio:Number(portfolioRows[0]?.portfolio??0)}},
    {headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}})
}

export async function POST(req: NextRequest) {
  const denied = accessGate(req,"sales")
  if (denied) return denied
  // P5.15.29 contre-audit (CONC-ACTEUR) : figer l'acteur APRÈS la porte d'accès,
  // avant toute transaction. Relire la session au milieu de la transaction
  // (currentActor) peut renvoyer null sous contention SQLite (readSession
  // échoue proprement et renvoie null) et provoquait un TypeError
  // « reading 'username' » : l'identité a déjà été validée par accessGate,
  // elle porte seule la décision et l'attribution de l'écriture.
  const actor=currentActor(req)
  if (!actor) return NextResponse.json({error:"Session indisponible : se reconnecter"},{status:401})
  const actorName=actor.username





  const body = await req.json().catch(() => null)
  const parsed = OrderCreateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Corps de requête invalide", details: parsed.error.flatten() }, { status: 400 })
  const data = parsed.data
  // Le motif de confirmation n'appartient pas à la commande métier ni à
  // l'empreinte d'idempotence : une reprise réseau retrouve la même commande.
  const providedReview = body?.duplicateReview
  const reviewParsed = providedReview == null ? null : DuplicateReviewSchema.safeParse(providedReview)
  if (reviewParsed && !reviewParsed.success)
    return NextResponse.json({error:"Confirmation de doublon invalide : motif de 12 à 300 caractères"},{status:400})
  const duplicateReview = reviewParsed?.success ? reviewParsed.data : null
  // Un jeton représente UNE intention utilisateur (double-clic, retry réseau).
  // Sans en-tête, deux commandes identiques restent volontairement autorisées.
  const clientKey = req.headers.get("Idempotency-Key")
  if (clientKey !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(clientKey))
    return NextResponse.json({error:"Idempotency-Key invalide (8 à 128 caractères sûrs)"},{status:400})
  const createRequestKey = clientKey
    ? createHash("sha256").update(actorName + "\0" + clientKey).digest("hex") : null
  const createRequestDigest = clientKey
    ? createHash("sha256").update(JSON.stringify(data)).digest("hex") : null
  const replay = async () => {
    if (!createRequestKey) return null
    const prior = await db.order.findUnique({where:{createRequestKey},include})
    if (!prior) return null
    if (prior.createdBy !== actorName || prior.createRequestDigest !== createRequestDigest)
      return NextResponse.json({error:"Cette clé correspond à une demande différente"},{status:409})
    return NextResponse.json({order:orderResponse(prior,actor)},
      {status:200,headers:{"Idempotency-Replayed":"true"}})
  }
  // Avant même la vérification du catalogue : une commande déjà validement créée
  // reste retrouvable après une coupure réseau ou une modification ultérieure.
  const existingResponse = await replay()
  if (existingResponse) return existingResponse
  // V18.9.1 (contre-audit A-07, symétrie ventes) : qty (10 000) × prix (10^8)
  // × 100 lignes peut dépasser l'entier sûr JavaScript : aucun total hors
  // limites ne doit être écrit.
  if (!data.lines.every(l => Number.isSafeInteger(Math.round(l.qty * l.unitPrice * 100))))
    return NextResponse.json({ error: "Montant hors limites arithmétiques sûres : réduire la quantité ou le prix unitaire" }, { status: 400 })
  const client = await db.client.findUnique({ where: { id: data.clientId } })
  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 })
  const products = await db.product.findMany({ where: { id: { in: data.lines.filter(l=>l.productId>0).map(l=>l.productId) },isOrderScoped:false } })
  const byId = new Map(products.map((p) => [p.id, p]))
  for (const line of data.lines) {
    if (line.generic) byId.set(line.productId,genericVirtualProduct(line.generic,line.unitPrice,line.productId))
  }
  if (data.lines.some((l) => !byId.has(l.productId))) return NextResponse.json({ error: "Un produit est introuvable" }, { status: 404 })
  if (products.some(p => (p.materialId==null && p.unit !== unitForFamily(p.family)) || (p.materialId!=null && p.family!=="NEGOCE") || validateTechnicalSpecs(p)))
    return NextResponse.json({error:"Produit avec unité ou classification technique incohérente"},{status:400})

  // La référence commerciale de négoce lit le stock de sa matière source.
  const linkedIds=products.flatMap(p=>p.materialId==null?[]:[p.materialId])
  const linkedMaterials=await db.material.findMany({where:{id:{in:linkedIds}}})
  const materialsById=new Map(linkedMaterials.map(m=>[m.id,m]))
  for(const line of data.lines){
    const p=byId.get(line.productId)!
    if(p.materialId==null)continue
    const m=materialsById.get(p.materialId)
    if(!m||!m.isSellable||!m.salesUnit||p.unit!==m.salesUnit||p.unitsPerSale!==m.unitsPerSale ||
      stockForSale(line.qty,p.unit,m.unit,p.unitsPerSale)==null || line.parts?.length || line.pieceCount || line.ensembleCount)
      return NextResponse.json({error:"Article de négoce : quantité/unité incohérente ou article non vendable"},{status:400})
  }
  // Le montant d'une référence spéciale n'est jamais libre : jusqu'au visa
  // directeur, seul le prix PROPOSÉ peut figurer sur une commande provisoire.
  // Une fois approuvé, seul le prix exact autorisé peut être soumis.
  for(const line of data.lines){
    const p=byId.get(line.productId)!
    if(!p.specialNotes)continue
    const validPrice=p.specialPriceStatus==="approved"?p.specialApprovedUnitPrice:p.unitPrice
    if(p.specialPriceStatus==="rejected"||!isSameAuthorizedPrice(line.unitPrice,validPrice))
      return NextResponse.json({error:"Prix spécial non autorisé ou différent du prix soumis au directeur"},{status:409})
  }
  // Toute référence provisoire exige validation. Références refusées interdites.
  if (products.some(p=>!(["active","pending_validation"].includes(p.status)))) return NextResponse.json({error:"Un produit n'est pas autorisé à la commande"},{status:400})
  const pendingIds=products.filter(p=>p.status==="pending_validation").map(p=>p.id)
  if(pendingIds.length){
    const attached=await db.orderLine.findFirst({where:{productId:{in:pendingIds}}})
    if(attached) {
      const alreadyCommitted = await replay()
      if (alreadyCommitted) return alreadyCommitted
      return NextResponse.json({error:"Une référence provisoire est déjà liée à une autre commande"},{status:409})
    }
  }
  // Interdire de créer une vente de salon à l'unité, même via un appel API direct.
  if (data.lines.some(l => byId.get(l.productId)?.family === "SALON" && byId.get(l.productId)?.unit !== "ml")) {
    return NextResponse.json({error:"Les salons doivent être facturés au mètre linéaire : installer la base corrigée"},{status:400})
  }
  if (data.lines.some(l => ["SALON","OUATE"].includes(byId.get(l.productId)?.family ?? "") && l.unitPrice <= 0)) {
    return NextResponse.json({error:"Saisir un tarif positif pour le salon en MAD/ml"},{status:400})
  }
  if(data.lines.some(l=>byId.get(l.productId)?.materialId!=null && l.dimensions))
    return NextResponse.json({error:"Une matière revendue doit conserver sa référence et ses dimensions de stock"},{status:400})
  // Construit et valide toutes les pièces avant toute écriture en base.
  const planPieces = (ref: string) => data.lines.map((l, i) => {
      const product = byId.get(l.productId)!
      const pieces = product.materialId!=null ? [] : buildPieces({
        orderRef: ref, lineNo: i+1, label: product.name, family: product.family,
        quantity: l.qty, unit: product.unit, pieceCount: l.pieceCount, ensembleCount: l.ensembleCount,
        shape: l.shape, extra: l.extra,
        dimensionless:l.generic?.template==="GEN-DIV"&&l.generic.lengthCm===undefined,
        defaultDimensions: l.dimensions ?? { lengthCm: product.length, widthCm: product.width, heightCm: product.height },
        // Cotes personnalisées uniquement pour pièces standards, jamais pour gabarit défini.
        parts: l.parts?.map(p => p.gabaritCode && p.gabaritCode !== "STD" ?
          {...p, lengthCm:product.length, widthCm:product.width, heightCm:product.height} :
          l.dimensions?{...p,...l.dimensions}:p),
      })
      return { ...l, product, pieces }
    })
  try {
    const preflight = planPieces("CMD-PRECHECK")
    if (preflight.reduce((sum, l) => sum + l.pieces.length, 0) > 1000) throw new Error("Maximum 1 000 étiquettes par commande")
  } catch (e) {
    // P5.15.21 (INFO-001) : seuls les messages de validation métier calculés
    // localement (gabarits, pièces, quantités) sont renvoyés au client. Toute
    // autre erreur (infrastructure, prototype, dépendance) est remplacée par
    // un message générique : jamais de message interne ni de détail technique.
    const message = e instanceof Error && /étiquette|pièce|gabarit|quantité|dimensions|métrage|ensemble|forme|unité|salon|ouate|facturation|tolérance|cotes|référence de banquette/i.test(e.message) && e.message.length <= 200
      ? e.message
      : null
    return NextResponse.json({ error: message ?? "Gabarits ou pièces invalides : vérifier dimensions, formes et quantités" }, { status: 400 })
  }
  let frozenQuoteProducts:{name:string;sku:string;unit:string}[]=[]
  let quoteLineVisas:ReturnType<typeof readQuoteVisas>={}
  let quotePlan:QuotePricePlan|null=null
  if(data.quoteId){
    const quote=await db.salesQuote.findUnique({where:{id:data.quoteId}})
    const {quoteId:omit, ...source}=data
    if(!quote || quote.status!=="accepted" || quote.clientId!==data.clientId ||
      JSON.stringify(source)!==quote.payload || (quote.expiresAt && quote.expiresAt<new Date())) {
      const alreadyCommitted = await replay()
      if (alreadyCommitted) return alreadyCommitted
      return NextResponse.json({error:"Devis non accepté, expiré ou contenu modifié"},{status:409})
    }
    quoteLineVisas=readQuoteVisas(quote.priceApprovalsJson)
    try{quotePlan=quoteReviewPlan(quote.priceReviewPlanJson,data.lines)}
    catch{return NextResponse.json({error:"Devis ancien ou photographie tarifaire invalide : rééditer un devis V2"},{status:409})}
    for(const [index,line] of data.lines.entries()){
      if(quotePlan[index].required && !quoteLineVisaValid(quoteLineVisas,index,line))
        return NextResponse.json({error:`Devis : prix ligne ${index+1} sans visa individuel valide`},{status:409})
    }
    // La conversion utilise la désignation négociée sur le devis d'origine.
    // Les devis historiques sans photographie gardent le repli catalogue.
    try { const parsed:unknown=JSON.parse(quote.productsSnapshotJson??"[]")
      if(Array.isArray(parsed) && parsed.length===data.lines.length && parsed.every(x=>x&&typeof x.name==="string"&&typeof x.sku==="string"))
        frozenQuoteProducts=parsed as {name:string;sku:string;unit:string}[]
    } catch { /* photographie absente/invalide : ancien devis */ }
  }
  try {
    const result = await serializedSQLiteWrite(() => db.$transaction(async tx=>{
      if (createRequestKey) {
        const prior = await tx.order.findUnique({where:{createRequestKey},include})
        if (prior) {
          if (prior.createdBy !== actorName || prior.createRequestDigest !== createRequestDigest)
            throw new Error("IDEMPOTENCY_KEY_REUSED")
          return {order:prior,replayed:true}
        }
      }
      // P5 : verrou métier sur numéro externe + détection de similarité
      // DANS la même transaction que la commande et les OF.
      const check = await lookupOrderDuplicates(tx, data)
      if(check.existingReference) throw new DuplicateOrderConflict(duplicateConflict(check)!)
      if (check.token && (duplicateReview?.token !== check.token || !duplicateReview?.reason))
        throw new DuplicateOrderConflict(duplicateConflict(check)!)
      if(!check.token && duplicateReview)
        throw new DuplicateOrderConflict({code:"DUPLICATE_REVIEW_STALE",error:"L'état des commandes similaires a changé : relancer la vérification"})
      // Allocate a new reference inside each isolated attempt, never reusing a failed value.
      if(data.quoteId){
        const changed=await tx.salesQuote.updateMany({where:{id:data.quoteId,status:"accepted"},data:{status:"converted"}})
        if(changed.count!==1)throw new Error("Devis déjà converti")
      }
      // Relecture transactionnelle : une proposition/prix peut avoir changé
      // entre la première validation et la création de la commande.
      const fresh=await tx.product.findMany({where:{id:{in:products.map(p=>p.id)},isOrderScoped:false}})
      for(const line of data.lines){
        if(line.generic)continue
        const p=fresh.find(p=>p.id===line.productId)
        if(!p || !["active","pending_validation"].includes(p.status))throw new Error("PRODUCT_CHANGED")
        if(p.materialId!=null){
          const m=await tx.material.findUnique({where:{id:p.materialId}})
          if(!m || !m.isSellable || p.unit!==(m.salesUnit??m.unit) || p.unitsPerSale!==m.unitsPerSale || stockForSale(line.qty,p.unit,m.unit,p.unitsPerSale)==null)
            throw Error("TRADE_CHANGED")
        }
        if(!p.specialNotes && p.unitPrice!==byId.get(p.id)?.unitPrice)throw new Error("CATALOG_PRICE_CHANGED")
        if(p.specialNotes){
          const allowed=p.specialPriceStatus==="approved"?p.specialApprovedUnitPrice:p.unitPrice
          if(p.specialPriceStatus==="rejected" || !isSameAuthorizedPrice(line.unitPrice,allowed))throw new Error("SPECIAL_PRICE_CHANGED")
        }
      }
      const ref = await nextRef("CMD", "order", tx)
      // V2: aucune fiche technique générique n'existe avant la validation de la
      // création CMD ; objets internes créés ICI, rollback atomique en cas d'échec.
      const scopedIds=new Map<number,number>()
      for(const [index,line] of data.lines.entries()) {
        if(!line.generic)continue
        const g=line.generic,virtual=byId.get(line.productId)!
        // D-GEN-01 (option D) : la fiche interne porte les champs taxonomiques
        // réellement saisis — le trigger V16 valide ces valeurs comme toute
        // fiche catalogue, aucun contournement.
        const product=await tx.product.create({data:{
          sku:`INT-GEN-${ref}-${String(index+1).padStart(3,"0")}`,
          name:g.description,model:g.template,family:virtual.family,variant:"STD",
          length:g.lengthCm??0,width:g.widthCm??0,height:g.heightCm??0,unit:virtual.unit,
          unitPrice:line.unitPrice,status:"active",isOrderScoped:true,
          coreType:g.coreType??null,foamComposition:g.foamComposition??null,mattressFinish:g.mattressFinish??null,
          foamNature:g.foamNature??null,foamDensity:g.foamDensity??null,foamGrade:g.foamGrade??null,
          foamLayers:g.foamLayers?JSON.stringify(g.foamLayers):null,
          technicalAttributesJson:JSON.stringify(g),
        }})
        scopedIds.set(index,product.id)
        await tx.auditEvent.create({data:{actor:actorName,action:"ORDER_GENERIC_TECHNICAL_RECORD_CREATED",
          entity:"Product",entityId:String(product.id),details:JSON.stringify({orderRef:ref,line:index+1,template:g.template})}})
      }
      const planned = planPieces(ref)
      const needsPriceReview=planned.some((l,index)=>
        (quotePlan?quotePlan[index].required:!!l.generic || (!l.product.specialNotes && hasPriceException(l.unitPrice,l.product.unitPrice))) &&
        !quoteLineVisaValid(quoteLineVisas,index,data.lines[index]))
      const needsTechnicalReview=planned.some(l=>hasTechnicalException(l.product,l.dimensions,l.technicalInstructions))
      const status=validatedOrderStatus(needsPriceReview,needsTechnicalReview,pendingIds.length>0)
      const created=await tx.order.create({
      data: {
        ref, clientId: data.clientId, quoteId:data.quoteId??null,
        status, priority: data.priority,
        // P5.15.21 (SEP-001) : tracé du créateur pour la garde quatre-yeux
        // (l'approbation refuse désormais créateur == validateur).
        createdBy: actorName,
        createRequestKey, createRequestDigest,
        dueDate: new Date(data.dueDate), note: data.note ?? null,
        customerOrderNo: data.customerOrderNo?.trim() || null,
        customerOrderNoNormalized: normalizeCustomerOrderNo(data.customerOrderNo),
        lines: { create: planned.map((l,index) => ({
          productId: scopedIds.get(index)??l.productId, qty: l.qty, unit: l.product.unit, unitPrice: l.unitPrice,
          kind:l.generic?"GENERIC":"CATALOG",genericTemplate:l.generic?.template??null,
          technicalSnapshotJson:JSON.stringify(l.generic?genericLineSnapshot(l.generic,l.unitPrice,l.qty):catalogLineSnapshot(l.product,l.unitPrice,l.qty,l.dimensions,l.technicalInstructions)),
          technicalSnapshotHash:snapshotHash(l.generic?genericLineSnapshot(l.generic,l.unitPrice,l.qty):catalogLineSnapshot(l.product,l.unitPrice,l.qty,l.dimensions,l.technicalInstructions)),
          catalogUnitPriceSnapshot:quotePlan?quotePlan[index].catalogPrice:l.product.unitPrice,
          priceApprovalStatus:(quotePlan?quotePlan[index].required:!!l.generic || (!l.product.specialNotes && hasPriceException(l.unitPrice,l.product.unitPrice)))
            ? quoteLineVisaValid(quoteLineVisas,index,data.lines[index])?"approved":"pending":"not_required",
          priceApprovedBy:quoteLineVisaValid(quoteLineVisas,index,data.lines[index])?quoteLineVisas[String(index)].by:null,
          priceApprovedAt:quoteLineVisaValid(quoteLineVisas,index,data.lines[index])?new Date(quoteLineVisas[String(index)].at):null,
          priceApprovalReason:quoteLineVisaValid(quoteLineVisas,index,data.lines[index])?quoteLineVisas[String(index)].reason:null,
          technicalInstructions:l.technicalInstructions?.trim()||null,
          customDimensionsJson:l.dimensions?JSON.stringify(l.dimensions):null,
          technicalReviewRequired:hasTechnicalException(l.product,l.dimensions,l.technicalInstructions),
          stockUnit:l.product.materialId==null?null:materialsById.get(l.product.materialId)!.unit,
          stockUnitsPerSale:l.product.materialId==null?1:l.product.unitsPerSale,
          modelRef: l.modelRef ?? null, configRef: l.configRef ?? null,
          productNameSnapshot: frozenQuoteProducts[index]?.name??l.product.name,
          productSkuSnapshot: l.generic?"HORS CATALOGUE — référence non attribuée":frozenQuoteProducts[index]?.sku??l.product.sku,
          pieces: {create: l.pieces},
        })) },
      },
      include,
      })
      await tx.auditEvent.create({data:{actor:actorName,action:"CUSTOMER_ORDER_CREATED",entity:"Order",entityId:String(created.id),details:JSON.stringify({ref:created.ref,clientId:created.clientId})}})
      if (check.token && duplicateReview) {
        await tx.auditEvent.create({data:{actor:actorName,action:"CUSTOMER_ORDER_DUPLICATE_CONFIRMED",
          entity:"Order",entityId:String(created.id),details:JSON.stringify({
            ref:created.ref,matchedOrderRefs:check.matches.map(x=>x.ref),reason:duplicateReview.reason,
            reviewToken:check.token,
          })}})
      }
      // Toutes les commandes (même standard et négoce) attendent le visa d'un
      // responsable habilité, distinct du commercial. Aucun OF n'est créé ici.
      // Les contrôles tarifaires/techniques sont des prérequis, pas un visa CMD.
      return {order:created,replayed:false}
    }))
    return NextResponse.json({order:orderResponse(result.order,actor)},
      {status:result.replayed?200:201,...(result.replayed?{headers:{"Idempotency-Replayed":"true"}}:{})})
  } catch (e) {
    if(e instanceof DuplicateOrderConflict)
      return NextResponse.json(e.response,{status:409,headers:{"Cache-Control":"private, no-store"}})
    if(e instanceof Error && e.message==="GOCMD_DUPLICATE_SEARCH_LIMIT")
      return NextResponse.json({error:"Trop de commandes dans cette journée : contrôle de doublon non concluant"},{status:503})
    // Après collision entre processus, relecture de la transaction gagnante.
    // Ce contrôle n'étouffe pas une erreur de base : si aucune commande n'existe,
    // elle est remontée au traitement normal ci-dessous.
    if (createRequestKey) {
      const existing = await replay().catch(() => null)
      if (existing) return existing
    }
    // Une contrainte d'unicité peut avoir été gagnée par un autre processus.
    // Relire uniquement pour fournir le conflit documenté, sans inventer PASS.
    try {
      const refreshed=await db.$transaction(tx=>lookupOrderDuplicates(tx,data))
      if(refreshed.existingReference)
        return NextResponse.json(duplicateConflict(refreshed),{status:409})
    } catch { /* erreur d'infrastructure déjà traitée ci-dessous */ }
    // R13.2 (mission §2 C7) : une contention SQLite transitoire (verrou,
    // temporisation de transaction après épuisement des retries internes) est
    // un échec TECHNIQUE rejouable. Le renvoyer en 409 masquerait une erreur
    // serveur derrière un conflit commercial ; 503 + Retry-After distingue
    // clairement le métier (409) du technique (5xx), et la campagne C7
    // continue de traiter toute réponse 5xx comme un échec bloquant.
    const errCode=String((e as {code?:string})?.code ?? "")
    const errMsg=String((e as {message?:string})?.message ?? "")
    // P1008 (issue incertaine, fail-closed GOCMD_SQLITE_OUTCOME_UNCERTAIN) :
    // la transaction a pu être engagée — le client doit VÉRIFIER la commande
    // avant tout rejeu, jamais rejouer à l'aveugle.
    if(errCode==="P1008"){
      console.error("Issue incertaine creation commande (P1008)",safeErrorMetadata(e))
      return NextResponse.json({error:"Enregistrement en cours de vérification : contrôler si la commande a été créée avant de réessayer"},
        {status:503,headers:{"Retry-After":"5","Cache-Control":"private, no-store"}})
    }
    if(errCode==="P2028"||errCode==="P2034"||/SQLITE_BUSY|database is locked|database is busy/i.test(errCode+" "+errMsg)){
      console.error("Contention SQLite creation commande",safeErrorMetadata(e))
      return NextResponse.json({error:"Base momentanément occupée : réessayer l'enregistrement"},
        {status:503,headers:{"Retry-After":"2","Cache-Control":"private, no-store"}})
    }
    // Toute autre erreur Prisma (Unknown/Known hors codes métier ci-dessus)
    // reste technique : 503. Les conflits d'état métier sont des Error simples
    // (PRODUCT_CHANGED, TRADE_CHANGED, Devis déjà converti…) et conservent 409.
    if(/^PrismaClient/.test(String((e as {name?:string})?.name ?? ""))){
      console.error("Erreur technique creation commande",safeErrorMetadata(e))
      return NextResponse.json({error:"Enregistrement momentanément indisponible : réessayer"},
        {status:503,headers:{"Retry-After":"2","Cache-Control":"private, no-store"}})
    }
    // Collision sur le numéro externe, contrainte SQLite, etc. ; ne pas divulguer les données internes.
    console.error("Echec creation commande",safeErrorMetadata(e))
    return NextResponse.json({error:"Enregistrement impossible ; vérifier la base et réessayer"}, {status:409})
  }
}
