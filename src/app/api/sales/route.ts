import { safeErrorMetadata } from "@/lib/safe-server-error"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {createHash} from "node:crypto"
import type { Prisma } from "@prisma/client"
import { accessGate,hasPermission, currentActor, hasRole } from "@/lib/access-gate"
import { db } from "@/lib/db"
import { unitForFamily,validateTechnicalSpecs } from "@/lib/product-taxonomy"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { POST as createCustomerOrder } from "@/app/api/orders/route"
import { OrderCreateSchema, OrderCreateWithoutQuoteIdSchema } from "@/lib/order-create-schema"
import { genericVirtualProduct } from "@/lib/generic-order"
import { readQuoteVisas, quoteLineVisaValid, quoteLineDigest, createQuotePricePlan, quoteReviewPlan } from "@/lib/quote-line-prices"
import { buildPieces } from "@/lib/order-pieces"
import { salesInvoiceStatus } from "@/lib/sales-invoice-status"
import { isSameAuthorizedPrice } from "@/lib/special-price"
import { requireDirectorPriceConfirmation } from "@/lib/sensitive-confirmation"
import { hasPriceException } from "@/lib/commercial-authorization"
import { productDtoForActor } from "@/lib/product-dto"
import { stockForSale } from "@/lib/article-trade"
import { isValidStockQuantity } from "@/lib/stock-quantity"
import { reducePlacement } from "@/lib/p2p-placements"
import { nextRef } from "@/lib/erp-server"
import {stockFree,reservedLotQty,EPS} from "@/lib/sales-stock-reservation"
import {salesTaxAllowed} from "@/lib/sales-tax-policy"
import {allocateInvoiceTax,partialLineCredit} from "@/lib/sales-credit-lines"
import {isValidPurchaseQuantity} from "@/lib/purchase-quantity"

export const dynamic="force-dynamic"
const Id=z.number().int().positive()
const docInput=z.object({action:z.string().min(1)})
const audit=(actor:string,action:string,entity:string,id:number,details?:unknown)=>({actor,action,entity,entityId:String(id),details:details?JSON.stringify(details):null})
const cents=(v:number):number=>{const n=Math.round((v+Number.EPSILON)*100);if(!Number.isSafeInteger(n)||n<0||n>2_000_000_000)throw new Error("Montant hors limites");return n}
const sum=(values:number[])=>values.reduce((a,b)=>a+b,0)
const result=(error:string,status=400)=>NextResponse.json({error},{status})
async function ref(tx:Prisma.TransactionClient,kind:string){
  // A monotonic, database-backed counter avoids max+1 and count+1 races.
  const key=`${kind}:${new Date().getUTCFullYear()}`
  const row=await tx.salesDocCounter.upsert({where:{id:key},create:{id:key,value:1},update:{value:{increment:1}}})
  return `${kind}-${new Date().getUTCFullYear()}-${String(row.value).padStart(5,"0")}`
}
const quoteSchema=z.object({action:z.literal("quote"),payload:OrderCreateWithoutQuoteIdSchema,expiresAt:z.string().datetime().optional()})
const quoteState=z.object({action:z.literal("quote-state"),id:Id,state:z.enum(["sent","accepted","rejected"]),acceptanceRef:z.string().trim().max(180).optional()})
const convertSchema=z.object({action:z.literal("convert"),id:Id,duplicateReview:z.object({token:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(12).max(300)}).optional()})
const quotePriceDecision=z.object({action:z.literal("approve-quote-prices"),id:Id,lineIndex:z.number().int().min(0).max(99),reason:z.string().trim().min(8).max(500),sensitivePassword:z.string().min(1).max(256)})
const deliverySchema=z.object({action:z.literal("delivery"),orderId:Id,
  pieceIds:z.array(Id).max(1000).default([]),
  stockLines:z.array(z.object({orderLineId:Id,qty:z.number().finite().positive().max(1_000_000)})).max(100).default([]),
  note:z.string().trim().max(500).optional(),requestKey:z.string().uuid().optional()})
const reserveSchema=z.object({action:z.literal("reserve-stock"),orderId:Id,orderLineId:Id,qty:z.number().finite().min(0).max(1_000_000)})
const releaseSchema=z.object({action:z.literal("release-stock"),orderId:Id,orderLineId:Id})
const invoiceSchema=z.object({action:z.literal("invoice"),orderId:Id,deliveryIds:z.array(Id).min(1).max(100),taxRateBps:z.number().int().min(0).max(10000)})
const creditSchema=z.object({action:z.literal("credit"),invoiceId:Id,amountCents:z.number().int().positive(),reason:z.string().trim().min(5).max(500)})
const creditLinesSchema=z.object({action:z.literal("credit-lines"),invoiceId:Id,reason:z.string().trim().min(5).max(500),lines:z.array(z.object({invoiceLineId:Id,qty:z.number().finite().positive().max(1_000_000)})).min(1).max(100)})
const creditDecisionSchema=z.discriminatedUnion("action",[z.object({action:z.literal("approve-credit"),creditId:Id}),z.object({action:z.literal("reject-credit"),creditId:Id,reason:z.string().trim().min(10).max(500)}),z.object({action:z.literal("cancel-credit"),creditId:Id,reason:z.string().trim().min(10).max(500)})])
const paymentSchema=z.object({action:z.literal("payment"),invoiceId:Id,amountCents:z.number().int().positive(),reference:z.string().trim().min(3).max(120),method:z.enum(["virement","especes","cheque","carte","autre"])})

export async function GET(req:NextRequest){
  const denied=accessGate(req)
  if(denied)return denied
  if(!hasRole(req,"sales")&&!hasRole(req,"finance")&&!hasRole(req,"director"))return result("Accès commercial ou finance requis",403)
  if(hasRole(req,"director")&&!hasRole(req,"sales")&&!hasRole(req,"finance") && (req.nextUrl.searchParams.get("type")||"quotes")!=="quotes")
    return result("Accès aux devis uniquement",403)
  const kind=req.nextUrl.searchParams.get("type")||"quotes"
  const sp=req.nextUrl.searchParams
  const rawTake=sp.get("take")??"50",rawSkip=sp.get("skip")??"0"
  const take=Number(rawTake),skip=Number(rawSkip)
  const q=(sp.get("q")??"").trim(), sort=(sp.get("sort")??"date"), rawDir=sp.get("dir")??"desc"
  const dir: "asc"|"desc"=rawDir==="asc"?"asc":"desc"
  const orderIdText=sp.get("orderId"), orderId=orderIdText==null?null:Number(orderIdText)
  if(!Number.isSafeInteger(take)||take<1||take>100||!Number.isSafeInteger(skip)||skip<0||skip>10_000_000||
     q.length>100||!["date","montant","ref"].includes(sort)||!["asc","desc"].includes(rawDir)||
     (orderIdText!==null&&(!Number.isSafeInteger(orderId)||Number(orderId)<=0)))
    return result("Pagination ou filtres commerciaux invalides",400)
  const pagination=(total:number)=>({total,skip,take,pages:Math.max(1,Math.ceil(total/take))})

  if(kind==="availability"){
    if(!hasRole(req,"sales"))return result("Rôle ventes requis",403)
    const orderId=Number(req.nextUrl.searchParams.get("orderId"))
    if(!Number.isSafeInteger(orderId)||orderId<=0)return result("Identifiant commande invalide")
    const o=await db.order.findUnique({where:{id:orderId},include:{lines:{include:{product:true,reservations:true}},salesDeliveries:{include:{lines:true}}}})
    if(!o)return result("Commande inconnue",404)
    const ids=o.lines.flatMap(l=>l.product.materialId==null?[]:[l.product.materialId])
    const lots=ids.length?await db.stockLot.findMany({where:{materialId:{in:ids},status:"available",qty:{gt:0},OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},orderBy:[{expiresAt:{sort:"asc",nulls:"last"}},{receivedAt:"asc"},{id:"asc"}]}):[]
    const allPhysicalLots=ids.length?await db.stockLot.findMany({where:{materialId:{in:ids},status:{in:["available","quarantine","legacy_unverified"]},qty:{gt:0}},select:{materialId:true,qty:true}}):[]
    const booked=lots.length?await db.salesStockReservation.groupBy({by:["stockLotId"],where:{stockLotId:{in:lots.map(l=>l.id)}},_sum:{qty:true}}):[]
    const taken=new Map(booked.map(x=>[x.stockLotId,x._sum.qty??0]))
    const finishedIds=o.lines.filter(l=>l.product.materialId==null&&l.unit==="u").map(l=>l.product.id)
    const finishedLots=finishedIds.length?await db.finishedStockLot.findMany({where:{productId:{in:finishedIds},qty:{gt:0}},orderBy:[{expiresAt:{sort:"asc",nulls:"last"}},{receivedAt:"asc"},{id:"asc"}]}):[]
    const finishedBookings=finishedLots.length?await db.finishedStockReservation.findMany({where:{lotId:{in:finishedLots.map(l=>l.id)}}}):[]
    const finishedTaken=new Map<number,number>()
    for(const b of finishedBookings)finishedTaken.set(b.lotId,(finishedTaken.get(b.lotId)??0)+b.qty)
    const items=o.lines.filter(l=>l.product.materialId!=null).map(l=>{
      const materialLots=lots.filter(x=>x.materialId===l.product.materialId)
      const delivered=sum(o.salesDeliveries.flatMap(d=>d.lines.filter(x=>x.orderLineId===l.id).map(x=>x.qty)))
      const reserved=sum(l.reservations.map(r=>r.qty))
      return {orderLineId:l.id,product:l.product.name,unit:l.unit,remaining:Math.max(0,Math.round((l.qty-delivered)*1000)/1000),
        reservedStockQty:reserved,physicalStockQty:sum(allPhysicalLots.filter(x=>x.materialId===l.product.materialId).map(x=>x.qty)),
        blockedStockQty:sum(allPhysicalLots.filter(x=>x.materialId===l.product.materialId).map(x=>x.qty))-sum(materialLots.map(x=>x.qty)),
        freeStockQty:sum(materialLots.map(x=>stockFree(x.qty,taken.get(x.id)??0))),
        lots:materialLots.map(x=>({lotId:x.id,lotCode:x.lotCode,expiry:x.expiresAt,
          freeQty:stockFree(x.qty,taken.get(x.id)??0),reservedForOrderQty:l.reservations.find(r=>r.stockLotId===x.id)?.qty??0}))}
    })
    const finished=o.lines.filter(l=>l.product.materialId==null&&l.unit==="u").map(l=>{
      const stockLots=finishedLots.filter(s=>s.productId===l.product.id)
      const usable=stockLots.filter(s=>s.status==="available"&&(!s.expiresAt||s.expiresAt>new Date()))
      const delivered=sum(o.salesDeliveries.flatMap(d=>d.lines.filter(x=>x.orderLineId===l.id).map(x=>x.qty)))
      return {orderLineId:l.id,product:l.product.name,unit:l.unit,remaining:Math.max(0,l.qty-delivered),
        reservedStockQty:sum(finishedBookings.filter(b=>b.orderLineId===l.id).map(b=>b.qty)),
        physicalStockQty:sum(stockLots.map(s=>s.qty)),blockedStockQty:sum(stockLots.map(s=>s.qty))-sum(usable.map(s=>s.qty)),
        freeStockQty:sum(usable.map(s=>Math.max(0,s.qty-(finishedTaken.get(s.id)??0)))),finishedGoods:true,
        lots:usable.map(s=>({lotId:s.id,lotCode:s.lotCode,expiry:s.expiresAt,
          freeQty:Math.max(0,s.qty-(finishedTaken.get(s.id)??0)),
          reservedForOrderQty:finishedBookings.filter(b=>b.orderLineId===l.id&&b.lotId===s.id).reduce((n,b)=>n+b.qty,0)}))}
    })
    return NextResponse.json({orderId,fulfillmentStatus:o.fulfillmentStatus,items:[...items,...finished]},{headers:{"Cache-Control":"private, no-store"}})
  }
  if(kind==="quotes"){
    const where:Prisma.SalesQuoteWhereInput=q?{OR:[{ref:{contains:q}},{status:{contains:q}},
      {client:{name:{contains:q}}},{clientNameSnapshot:{contains:q}}]}:{}
    const orderBy:Prisma.SalesQuoteOrderByWithRelationInput[]=sort==="montant"?[{subtotalCents:dir},{id:"desc"}]:[{createdAt:dir},{id:"desc"}]
    const [total,items]=await Promise.all([
      db.salesQuote.count({where}),
      db.salesQuote.findMany({where,include:{client:true,order:{select:{id:true,ref:true,status:true}}},orderBy,skip,take}),
    ])
    // Libellés produits pour l'affichage lisible des lignes de devis
    // (le détail des lignes est stocké en JSON dans quote.payload).
    const ids=[...new Set(items.flatMap(q=>{try{const p=JSON.parse(q.payload) as {lines?:{productId:number}[]};return (p?.lines??[]).map(l=>Number(l.productId))}catch{return[]}}))]
    const products=ids.length?await db.product.findMany({where:{id:{in:ids}},select:{id:true,name:true,unitPrice:true}}):[]
    const productNames=Object.fromEntries(products.map(p=>[p.id,p.name]))
    const withVisas=items.map(q=>{
      const {priceApprovalsJson:internal,priceReviewPlanJson:internalPlan,...safe}=q
      let approvalLines:{index:number;approved:boolean;required:boolean;label:string}[]=[]
      let approvalPlanValid=true
      try{const payload=OrderCreateWithoutQuoteIdSchema.parse(JSON.parse(q.payload));const visas=readQuoteVisas(internal)
        const plan=quoteReviewPlan(internalPlan,payload.lines)
        approvalLines=payload.lines.map((line,index)=>{
          const required=plan[index].required
          return {index,required,approved:required?quoteLineVisaValid(visas,index,line):true,
            label:line.generic?.description??(products.find(p=>p.id===line.productId)?.name??`Produit #${line.productId}`)}
        })
      }catch{approvalPlanValid=false}
      return {...safe,approvalLines,approvalPlanValid}
    })
    return NextResponse.json({items:withVisas,productNames,catalogPrices:Object.fromEntries(products.map(p=>[p.id,p.unitPrice])),pagination:pagination(total)},{headers:{"Cache-Control":"private, no-store"}})
  }
  if(kind==="orders"){
    const where:Prisma.OrderWhereInput={AND:[q?{OR:[{ref:{contains:q}},{client:{name:{contains:q}}}]}:{},
      orderId!=null?{id:orderId}:{}]}
    const [total,items]=await Promise.all([
      db.order.count({where}),
      db.order.findMany({where,include:{client:true,lines:{include:{product:true,pieces:true}},salesDeliveries:{include:{lines:true}},salesInvoices:{select:{id:true,ref:true,status:true}}},orderBy:[{createdAt:"desc"},{id:"desc"}],take,skip}),
    ])
    // V18.9.9 (SEC-PROD-01) : DTO produit par permission dans les imbrications.
    const a=currentActor(req)
    // Les champs internes du contrôle anti-doublon / d'idempotence ne sont
    // jamais diffusés par la liste commerciale, même aux rôles autorisés.
    return NextResponse.json({pagination:pagination(total),items:items.map(o=>{
      const {createRequestKey:unusedKey,createRequestDigest:unusedDigest,customerOrderNoNormalized:unusedNormalized,...visible}=o
      void unusedKey;void unusedDigest;void unusedNormalized
      return {...visible,lines:o.lines.map(l=>({...l,product:productDtoForActor(l.product,a)}))}
    })})
  }
  if(kind==="deliveries"){
    const where:Prisma.SalesDeliveryWhereInput={AND:[orderId!=null?{orderId}:{},
      q?{OR:[{ref:{contains:q}},{order:{ref:{contains:q}}},{order:{client:{name:{contains:q}}}},{clientNameSnapshot:{contains:q}}]}:{}]}
    const [total,items]=await Promise.all([
      db.salesDelivery.count({where}),
      db.salesDelivery.findMany({where,include:{order:{include:{client:true}},lines:{include:{orderLine:{include:{product:true,pieces:true}},invoiceLine:true}}},orderBy:[{deliveredAt:dir},{id:"desc"}],skip,take}),
    ])
    const a=currentActor(req)
    // C4-06 (contre-audit CASCADE4) : la commande imbriquée est allégée des champs
    // internes d'idempotence/doublon, comme GET /api/orders.
    return NextResponse.json({pagination:pagination(total),items:items.map(d=>{
      const {createRequestKey:_k,createRequestDigest:_d,customerOrderNoNormalized:_n,...safeOrder}=d.order
      void _k;void _d;void _n
      return {...d,order:safeOrder,lines:d.lines.map(l=>l.orderLine?{...l,orderLine:{...l.orderLine,product:productDtoForActor(l.orderLine.product,a)}}:l)}
    })})
  }
  if(kind==="invoices"){
    if(!hasRole(req,"finance")&&!hasRole(req,"sales"))return result("Accès ventes ou finance requis",403)
    const where:Prisma.SalesInvoiceWhereInput=q?{OR:[{ref:{contains:q}},{status:{contains:q}},
      {client:{name:{contains:q}}},{clientNameSnapshot:{contains:q}},{order:{ref:{contains:q}}}]}:{}
    const orderBy:Prisma.SalesInvoiceOrderByWithRelationInput[]=sort==="montant"?[{totalCents:dir},{id:"desc"}]:
      sort==="ref"?[{ref:dir},{id:"desc"}]:[{issuedAt:dir},{id:"desc"}]
    const [total,items]=await Promise.all([
      db.salesInvoice.count({where}),
      db.salesInvoice.findMany({where,include:{client:true,order:{select:{ref:true}},lines:{include:{deliveryLine:{include:{orderLine:{include:{product:true}}}}}},payments:true,credits:true},orderBy,skip,take}),
    ])
    const a=currentActor(req)
    // P5.15.10 (AN-P2-01, politique SODEPI §7) : les règlements et avoirs sont
    // des données financières (permissions sales.payments / sales.credits,
    // réservées au rôle finance). Le rôle sales garde la vue des factures et
    // de leurs montants (prix qu'il a négociés) mais sans le détail des
    // paiements ni des avoirs, ni les références/mandats de règlement.
    // Audit indépendant 2026-11-12 (FIN-01-03) : la permission individuelle
    // sales.payments révoquée doit masquer le détail financier au même titre
    // que le relevé de compte (/api/sales/statement) — le rôle seul ne suffit pas.
    const canSeeFinanceDetails=hasRole(req,"finance")&&hasPermission(req,"sales.payments")
    const mapInvoice=(i:(typeof items)[number])=>({
      ...i,
      ...(canSeeFinanceDetails?{}:{
        payments:[],
        credits:[],
        financeDetailsMasked:true,
      }),
      lines:i.lines.map(l=>{
        if(!l.deliveryLine)return l
        const dl=l.deliveryLine
        if(!dl.orderLine)return l
        return {...l,deliveryLine:{...dl,orderLine:{...dl.orderLine,product:productDtoForActor(dl.orderLine.product,a)}}}
      }),
    })
    return NextResponse.json({items:items.map(mapInvoice),pagination:pagination(total)},{headers:{"Cache-Control":"private, no-store"}})
  }
  return result("Vue inconnue")
}

export async function POST(req:NextRequest){
  const denied=accessGate(req)
  if(denied)return denied
  const body=await req.json().catch(()=>null)
  if(!docInput.safeParse(body).success)return result("Action invalide")
  const actor=currentActor(req)!.username
  const action=body.action
  if(currentActor(req)?.managed){
    const permission=(["quote","quote-state","convert"].includes(action)?"sales.quotes":
      ["delivery","reserve-stock","release-stock"].includes(action)?"sales.deliveries":action==="invoice"?"sales.invoices":
      action==="payment"?"sales.payments":
      ["credit","credit-lines","approve-credit","reject-credit","cancel-credit"].includes(action)?"sales.credits":null)
    if(permission && !hasPermission(req,permission))return result("Permission désactivée pour cette opération",403)
  }
  if(["quote","quote-state","convert","delivery","reserve-stock","release-stock"].includes(action)&&!hasRole(req,"sales"))return result("Rôle ventes requis",403)
  if(action==="approve-quote-prices" && (!hasRole(req,"director") ||
      (currentActor(req)?.managed && !hasPermission(req,"director.prices"))))
    return result("Visa tarifaire réservé au directeur habilité",403)
  if(["invoice","credit","credit-lines","approve-credit","reject-credit","cancel-credit","payment"].includes(action)&&!hasRole(req,"finance"))return result("Rôle finance requis",403)
  try {
    if(action==="approve-quote-prices"){
      const parsed=quotePriceDecision.safeParse(body);if(!parsed.success)return result("Motif, devis ou confirmation personnelle invalide")
      const deniedConfirmation=await requireDirectorPriceConfirmation(req,parsed.data.sensitivePassword)
      if(deniedConfirmation)return deniedConfirmation
      const actor=currentActor(req)!.username
      const quote=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        const q=await tx.salesQuote.findUniqueOrThrow({where:{id:parsed.data.id}})
        if(q.status!=="draft"||q.createdBy===actor)throw Error("INVALID_STATE")
        const payload=OrderCreateWithoutQuoteIdSchema.parse(JSON.parse(q.payload))
        const line=payload.lines[parsed.data.lineIndex]
        if(!line)throw Error("LINE_MISSING")
        const product=line.generic?null:await tx.product.findFirst({where:{id:line.productId,isOrderScoped:false}})
        if(!line.generic&&!product)throw Error("PRODUCT_MISSING")
        const plan=quoteReviewPlan(q.priceReviewPlanJson,payload.lines)
        if(!plan[parsed.data.lineIndex].required)throw Error("NO_PRICE_EXCEPTION")
        const visas=readQuoteVisas(q.priceApprovalsJson)
        if(quoteLineVisaValid(visas,parsed.data.lineIndex,line))throw Error("ALREADY_APPROVED")
        visas[String(parsed.data.lineIndex)]={by:actor,at:new Date().toISOString(),reason:parsed.data.reason,digest:quoteLineDigest(line)}
        const updated=await tx.salesQuote.update({where:{id:q.id},data:{
          priceApprovalsJson:JSON.stringify(visas),priceApprovedBy:actor,priceApprovedAt:new Date(),priceApprovalReason:`Visas par ligne : ${Object.keys(visas).length}`}})
        await tx.auditEvent.create({data:audit(actor,"SALES_QUOTE_LINE_PRICE_APPROVED","SalesQuote",q.id,
          {lineIndex:parsed.data.lineIndex,reason:parsed.data.reason,ref:q.ref,digest:visas[String(parsed.data.lineIndex)].digest})})
        return updated
      }))
      return NextResponse.json({quote})
    }
    if(action==="quote"){
      const parsed=quoteSchema.safeParse(body);if(!parsed.success)return result("Devis invalide : produits, quantités ou gabarits à vérifier")
      const {payload,expiresAt}=parsed.data
      const catalogIds=[...new Set(payload.lines.filter(l=>!l.generic).map(l=>l.productId))]
      const products=await db.product.findMany({where:{id:{in:catalogIds},isOrderScoped:false}})
      if(products.length!==catalogIds.length)return result("Produit introuvable")
      const byId=new Map(products.map(p=>[p.id,p]))
      for(const line of payload.lines)if(line.generic)
        byId.set(line.productId,genericVirtualProduct(line.generic,line.unitPrice,line.productId))
      // Un devis peut être préparé en BROUILLON avant le visa directeur.
      // L'envoi est bloqué au serveur tant que le prix n'est pas autorisé.
      if(products.some(p=>!["active","pending_validation"].includes(p.status)))
        return result("Produit refusé ou inactif",409)
      for(const line of payload.lines){
        const p=byId.get(line.productId)!
        if(p.specialNotes && (p.specialPriceStatus==="rejected" ||
          !isSameAuthorizedPrice(line.unitPrice,p.specialPriceStatus==="approved"?p.specialApprovedUnitPrice:p.unitPrice)))
          return result("Prix du produit spécial différent de la proposition enregistrée",409)
      }
      if(products.some(p=>(p.materialId==null && p.unit!==unitForFamily(p.family)) || validateTechnicalSpecs(p)))return result("Référence ou fiche technique incohérente")
      const linked=await db.material.findMany({where:{id:{in:products.flatMap(p=>p.materialId==null?[]:[p.materialId])}}})
      const byMaterial=new Map(linked.map(m=>[m.id,m]))
      const client=await db.client.findUnique({where:{id:payload.clientId}});if(!client)return result("Client inconnu")
      let subtotal=0
      for(const [i,line] of payload.lines.entries()){
        const product=byId.get(line.productId)!
        if(product.family==="SALON"&&product.unit!=="ml")return result("Salon : unité ml requise")
        // Re-use the production validation when issuing a quote, before any writing.
        if(product.materialId!=null){
          const material=byMaterial.get(product.materialId)
          if(!material||!material.isSellable||product.unit!==(material.salesUnit??material.unit)||
             stockForSale(line.qty,product.unit,material.unit,product.unitsPerSale)==null ||
             line.parts?.length||line.pieceCount||line.ensembleCount)return result("Article de négoce invalide",400)
        }else{
          // A-023 (recette nov. 2026) : les erreurs de geometrie/gabarits de buildPieces
          // etaient masquees par le catch generique du POST (« Conflit de donnees »).
          // Le devis doit renvoyer le message precis, comme la creation de commande
          // (preflight explicite, cf. /api/orders).
          try{
            buildPieces({orderRef:"DEV-PRECHECK",lineNo:i+1,label:product.name,family:product.family,quantity:line.qty,unit:product.unit,
              pieceCount:line.pieceCount,ensembleCount:line.ensembleCount,shape:line.shape,extra:line.extra,
              defaultDimensions:line.dimensions??{lengthCm:product.length,widthCm:product.width,heightCm:product.height},
              parts:line.parts?.map(p=>p.gabaritCode&&p.gabaritCode!=="STD"?{...p,lengthCm:product.length,widthCm:product.width,heightCm:product.height}:p)})
          }catch(e){
            // P5.15.21 (INFO-001) : seuls les messages de validation métier de
            // buildPieces sont renvoyés ; toute autre erreur (infrastructure,
            // prototype) est remplacée par un message générique.
            return result(e instanceof Error&&/pièce|gabarit|quantité|dimensions|métrage|ensemble|forme|unité|salon|ouate|facturation|tolérance|cotes|étiquette|référence de banquette/i.test(e.message)&&e.message.length<=200?e.message:"Gabarit ou pièces invalides : vérifier dimensions, formes et quantités",400)}
        }
        subtotal+=cents(line.qty*line.unitPrice)
      }
      if(!Number.isSafeInteger(subtotal)||subtotal>2_000_000_000)return result("Montant de devis hors limites")
      const quote=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        // Reprendre les tarifs catalogue dans la transaction d'écriture :
        // l'éligibilité au visa ne dépend plus d'une lecture antérieure.
        const freshById=new Map(byId)
        // Garde dans la transaction, également contre un changement simultané.
        for(const line of payload.lines){
          if(line.generic)continue // GEN : snapshot autonome, aucune fiche catalogue créée dans le devis
          const p=await tx.product.findUniqueOrThrow({where:{id:line.productId}})
          if(p.isOrderScoped||!["active","pending_validation"].includes(p.status))throw Error("PRODUCT_CHANGED")
          freshById.set(p.id,p)
          if(p.materialId!=null){
            const m=await tx.material.findUnique({where:{id:p.materialId}})
            if(!m||!m.isSellable||p.unit!==(m.salesUnit??m.unit)||p.unitsPerSale!==m.unitsPerSale||stockForSale(line.qty,p.unit,m.unit,p.unitsPerSale)==null)
              throw Error("TRADE_CHANGED")
          }
          if(p.specialNotes && (p.specialPriceStatus==="rejected" ||
              !isSameAuthorizedPrice(line.unitPrice,p.specialPriceStatus==="approved"?p.specialApprovedUnitPrice:p.unitPrice)))
            throw new Error("SPECIAL_PRICE_CHANGED")
        }
        const plan=createQuotePricePlan(payload.lines,freshById)
        const q=await tx.salesQuote.create({data:{ref:await ref(tx,"DEV"),clientId:payload.clientId,payload:JSON.stringify(payload),
          priceReviewPlanJson:JSON.stringify(plan),
          clientNameSnapshot:client.name,
          productsSnapshotJson:JSON.stringify(payload.lines.map(l=>({name:freshById.get(l.productId)!.name,sku:freshById.get(l.productId)!.sku,unit:freshById.get(l.productId)!.unit}))),
          subtotalCents:subtotal,expiresAt:expiresAt?new Date(expiresAt):null,createdBy:actor,
          priceReviewRequired:plan.some(l=>l.required)}})
        await tx.auditEvent.create({data:audit(actor,"SALES_QUOTE_CREATED","SalesQuote",q.id,{ref:q.ref,subtotal})})
        return q
      }))
      return NextResponse.json({quote},{status:201})
    }
    if(action==="quote-state"){
      const parsed=quoteState.safeParse(body);if(!parsed.success)return result("Action devis invalide")
      const {id,state,acceptanceRef}=parsed.data
      if(state==="accepted"&&(!acceptanceRef||acceptanceRef.length<3))return result("Référence d'acceptation client obligatoire")
      const from=state==="sent"?["draft"]:["sent"]
      const quote=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        const current=await tx.salesQuote.findUniqueOrThrow({where:{id}})
        if(state==="sent"){
          const payload=OrderCreateWithoutQuoteIdSchema.parse(JSON.parse(current.payload))
          const ids=[...new Set(payload.lines.filter(l=>!l.generic).map(l=>l.productId))]
          const products=await tx.product.findMany({where:{id:{in:ids},isOrderScoped:false}})
          const byId=new Map(products.map(p=>[p.id,p]))
          if(products.length!==ids.length)throw Error("PRODUCT_MISSING")
          const visas=readQuoteVisas(current.priceApprovalsJson)
          const plan=quoteReviewPlan(current.priceReviewPlanJson,payload.lines)
          for(const [index,l] of payload.lines.entries()){
            const p=l.generic?null:byId.get(l.productId)
            if(!l.generic&&(!p || !["active","pending_validation"].includes(p.status) ||
              (p.status==="pending_validation"&&!p.specialNotes) ||
              (p.specialNotes&&(p.specialPriceStatus!=="approved"||!isSameAuthorizedPrice(l.unitPrice,p.specialApprovedUnitPrice)))))
              throw Error("DIRECTOR_PRICE_REQUIRED")
            if(plan[index].required&&!quoteLineVisaValid(visas,index,l))throw Error("DIRECTOR_PRICE_REQUIRED")
          }
        }
        const changed=await tx.salesQuote.updateMany({where:{id,status:{in:from},...(state==="accepted"?{OR:[{expiresAt:null},{expiresAt:{gte:new Date()}}]}:{})},data:{status:state,...(state==="accepted"?{acceptedBy:actor,acceptanceRef}: {})}})
        if(changed.count!==1)throw new Error("Transition interdite ou devis expiré")
        const q=await tx.salesQuote.findUniqueOrThrow({where:{id}})
        await tx.auditEvent.create({data:audit(actor,"SALES_QUOTE_"+state.toUpperCase(),"SalesQuote",id,{acceptanceRef:acceptanceRef??null})})
        return q
      }))
      return NextResponse.json({quote})
    }
    if(action==="convert"){
      const parsed=convertSchema.safeParse(body);if(!parsed.success)return result("Devis invalide")
      const quote=await db.salesQuote.findUnique({where:{id:parsed.data.id}})
      if(!quote||quote.status!=="accepted")return result("Devis non accepté ou déjà transformé",409)
      const data=JSON.parse(quote.payload) as Record<string,unknown>
      // Order API executes the exact same buildPieces, RBAC, product validation and DB transaction.
      const headers=new Headers(req.headers)
      // Body is rebuilt: never forward the original payload length/encoding.
      for(const name of ["content-length","content-encoding","transfer-encoding"])headers.delete(name)
      headers.set("content-type","application/json")
      return createCustomerOrder(new NextRequest(req.url,{method:"POST",headers,body:JSON.stringify({...data,quoteId:quote.id,...(parsed.data.duplicateReview?{duplicateReview:parsed.data.duplicateReview}:{})})}))
    }
    if(action==="reserve-stock" || action==="release-stock"){
      const parsed=action==="reserve-stock"?reserveSchema.safeParse(body):releaseSchema.safeParse(body)
      if(!parsed.success)return result("Réservation invalide")
      const {orderId,orderLineId}=parsed.data
      const targetQty=parsed.data.action==="reserve-stock"?parsed.data.qty:0
      const data=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        // Un verrou d'écriture SQLite est obtenu AVANT la lecture des réservations.
        await tx.salesDocCounter.upsert({where:{id:"GOCMD_STOCK_RESERVATION_LOCK"},create:{id:"GOCMD_STOCK_RESERVATION_LOCK",value:1},update:{value:{increment:1}}})
        const o=await tx.order.findUniqueOrThrow({where:{id:orderId},include:{lines:{include:{product:true}},salesDeliveries:{include:{lines:true}}}})
        if(o.fulfillmentStatus!=="open" || !["new","production","ready","shipped"].includes(o.status))throw Error("Commande non validée ou suspendue")
        const line=o.lines.find(l=>l.id===orderLineId)
        if(line?.product.specialNotes && (line.product.specialPriceStatus!=="approved" || !isSameAuthorizedPrice(line.unitPrice,line.product.specialApprovedUnitPrice)))throw Error("Prix spécial non approuvé")
        if(!line||!line.product.materialId||!line.stockUnit)throw Error("Article de négoce introuvable")
        // RR-06: an already prepared resale OF owns these reservations.
        // Changes must pass through the OF cancellation/suspension workflow;
        // otherwise a user could release committed stock before delivery.
        const preparedOf=await tx.workOrder.findFirst({where:{orderLineId:line.id,status:"completed",preparationKind:"stock"},select:{id:true}})
        if(preparedOf)throw Error("Réservation verrouillée par un OF préparé : suspendre ou annuler d'abord l'OF")
        const delivered=sum(o.salesDeliveries.flatMap(d=>d.lines.filter(x=>x.orderLineId===line.id).map(x=>x.qty)))
        if(targetQty>line.qty-delivered+EPS)throw Error("Réservation supérieure au reliquat")
        const needed=targetQty===0?0:stockForSale(targetQty,line.unit,line.stockUnit,line.stockUnitsPerSale)
        if(needed===null)throw Error("Quantité ou conversion invalide")
        await tx.salesStockReservation.deleteMany({where:{orderLineId}})
        let remaining=needed
        const lots=await tx.stockLot.findMany({where:{materialId:line.product.materialId,status:"available",qty:{gt:0},OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},orderBy:[{expiresAt:{sort:"asc",nulls:"last"}},{receivedAt:"asc"},{id:"asc"}]})
        for(const lot of lots){
          if(remaining<EPS)break
          const free=stockFree(lot.qty,await reservedLotQty(tx,lot.id))
          const qty=Math.round(Math.min(free,remaining)*1000)/1000
          if(qty<=0)continue
          if(!isValidStockQuantity(qty,line.stockUnit))throw Error("Lot non divisible")
          await tx.salesStockReservation.create({data:{orderLineId,stockLotId:lot.id,qty,createdBy:actor}})
          remaining=Math.round((remaining-qty)*1000)/1000
        }
        if(remaining>EPS)throw Error("Stock non réservé insuffisant")
        await tx.auditEvent.create({data:audit(actor,targetQty?"SALES_STOCK_RESERVED":"SALES_STOCK_RELEASED","OrderLine",orderLineId,{orderId,targetQty,stockQty:needed})})
        return {orderId,orderLineId,reservedQty:needed,unit:line.stockUnit}
      }))
      return NextResponse.json(data)
    }
    if(action==="delivery"){
      const parsed=deliverySchema.safeParse(body);if(!parsed.success)return result("Livraison invalide : pièces et/ou quantités de négoce à vérifier")
      const {orderId,pieceIds,stockLines,note,requestKey}=parsed.data
      const requestHash=requestKey?createHash("sha256").update(JSON.stringify({orderId,pieceIds,stockLines,note:note??null})).digest("hex"):null
      if(requestKey){
        const posted=await db.salesDelivery.findUnique({where:{requestKey}})
        if(posted)return posted.orderId===orderId && posted.requestHash===requestHash?NextResponse.json({delivery:posted,idempotent:true}):result("Jeton déjà utilisé avec un autre contenu",409)
      }
      if(!pieceIds.length&&!stockLines.length)return result("Sélectionner une pièce ou une quantité d'article à livrer")
      if(new Set(pieceIds).size!==pieceIds.length)return result("Pièce présente deux fois")
      if(new Set(stockLines.map(l=>l.orderLineId)).size!==stockLines.length)return result("Ligne de négoce présente deux fois")
      const delivery=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        const order=await tx.order.findUniqueOrThrow({where:{id:orderId},include:{lines:{include:{pieces:true,product:true}},salesDeliveries:{include:{lines:true}}}})
        if(order.fulfillmentStatus!=="open")throw Error("Commande suspendue ou clôturée")
        if(!["ready","shipped"].includes(order.status))throw Error("Commande non prête : livraison interdite")
        // Les nouvelles CMD ont un OF par ligne, même pour les achats revendus.
        // Empêcher la sortie de stock si un OF est encore en brouillon, annulé
        // ou incomplet. Les commandes historiques sans OF restent traitables.
        const workOrders=await tx.workOrder.findMany({where:{orderId},select:{orderLineId:true,status:true,preparationKind:true}})
        const lineIds=new Set(order.lines.map(l=>l.id))
        if(workOrders.length && (workOrders.length!==order.lines.length ||
            workOrders.some(of=>!lineIds.has(of.orderLineId)||of.status!=="completed")))
          throw Error("OF_INCOMPLETE_OR_MISSING")
        if(order.lines.some(l=>l.product.specialNotes && (l.product.specialPriceStatus!=="approved" ||
            !isSameAuthorizedPrice(l.unitPrice,l.product.specialApprovedUnitPrice))))throw Error("Prix spécial non approuvé")
        const all=order.lines.flatMap(l=>l.pieces.map(p=>({p,l})))
        const chosen=all.filter(x=>pieceIds.includes(x.p.id))
        if(chosen.length!==pieceIds.length)throw Error("Pièce hors commande")
        if(stockLines.some(s=>chosen.some(x=>x.l.id===s.orderLineId)))
          throw Error("Livraison doublonnée : même ligne en pièces et prélèvement stock")
        const used=new Set(order.salesDeliveries.flatMap(d=>d.lines.flatMap(l=>JSON.parse(l.pieceIds) as number[])))
        if(chosen.some(x=>used.has(x.p.id)))throw Error("Pièce déjà livrée")
        // Une préparation sur stock fini DOIT être livrée par prélèvement de
        // ses lots réservés, pas par la voie « pièce fabriquée » sans débit.
        if(chosen.some(x=>x.l.product.materialId==null && x.l.unit==="u" &&
            workOrders.some(w=>w.orderLineId===x.l.id&&w.preparationKind==="stock")))
          throw Error("MATELAS_STOCK_USE_RESERVED_DELIVERY")
        const buckets=new Map<number,{ids:number[],qty:number,unit:string}>()
        for(const {p,l} of chosen){
          if(l.product.materialId!=null)throw Error("Article de négoce : sélectionner sa quantité, pas une pièce")
          const item=buckets.get(l.id)??{ids:[],qty:0,unit:l.unit}
          const qty=l.unit==="ml"?p.linearMeters:l.unit==="kg"?l.qty:1
          if(qty==null||!Number.isFinite(qty)||qty<=0)throw Error("Métrage pièce invalide")
          item.ids.push(p.id);item.qty+=qty;buckets.set(l.id,item)
        }
        const trade=new Map<number,{materialId:number,stockQty:number,stockUnit:string}>()
        const finished=new Map<number,{productId:number,qty:number}>()
        for(const requested of stockLines){
          const line=order.lines.find(x=>x.id===requested.orderLineId)
          if(!line)throw Error("Ligne hors commande")
          // Produits finis MATELAS en stock : la CMD et les OF restent identiques.
          // Les IDs des pièces commerciales sont affectés exactement une fois à la sortie.
          if(line.product.materialId==null){
            if(line.unit!=="u"||
               !Number.isSafeInteger(requested.qty)||requested.qty<1)throw Error("Stock fini réservé aux produits à l'unité")
            const deliveredSet=new Set(used)
            const freePieces=line.pieces.filter(p=>!deliveredSet.has(p.id)).sort((a,b)=>a.sequence-b.sequence)
            if(requested.qty>freePieces.length)throw Error("Quantité de produits finis en stock supérieure aux pièces restantes")
            const ids=freePieces.slice(0,requested.qty).map(p=>p.id)
            finished.set(line.id,{productId:line.product.id,qty:requested.qty})
            buckets.set(line.id,{ids,qty:requested.qty,unit:line.unit})
            continue
          }
          if(!line.stockUnit)throw Error("Unité de stock absente")
          const material=await tx.material.findUnique({where:{id:line.product.materialId}})
          if(!material || !material.isSellable || line.stockUnit!==material.unit)throw Error("Article de négoce non vendable ou unité modifiée")
          const stockQty=stockForSale(requested.qty,line.unit,material.unit,line.stockUnitsPerSale)
          if(stockQty==null)throw Error("Quantité incompatible avec unité de vente et unité de stock")
          trade.set(line.id,{materialId:material.id,stockQty,stockUnit:material.unit})
          buckets.set(line.id,{ids:[],qty:requested.qty,unit:line.unit})
        }
        for(const line of order.lines){
          const already=sum(order.salesDeliveries.flatMap(d=>d.lines.filter(x=>x.orderLineId===line.id).map(x=>x.qty)))
          const current=buckets.get(line.id)?.qty??0
          if(current>0 && (!isValidStockQuantity(current,line.unit)||already+current>line.qty+1e-7))
            throw Error("Quantité livrée supérieure à la commande ou unité invalide")
        }
        const d=await tx.salesDelivery.create({data:{ref:await ref(tx,"BLC"),orderId,note:note??null,createdBy:actor,requestKey:requestKey??null,requestHash,
          clientNameSnapshot:(await tx.client.findUniqueOrThrow({where:{id:order.clientId}})).name,
          lines:{create:[...buckets.entries()].map(([orderLineId,item])=>{
            const source=order.lines.find(line=>line.id===orderLineId)!
            return {orderLineId,qty:Math.round(item.qty*1000)/1000,unit:item.unit,pieceIds:JSON.stringify(item.ids),
              productNameSnapshot:source.productNameSnapshot??source.product.name,
              productSkuSnapshot:source.productSkuSnapshot??source.product.sku}
          })}},
          include:{lines:true}})
        const consumed:{lineId:number,lotId:number,qty:number}[]=[]
        for(const [lineId,requested] of trade){
          const deliveryLine=d.lines.find(l=>l.orderLineId===lineId)!
          let remaining=requested.stockQty
          // FEFO puis ancienneté ; aucun prélèvement de quarantaine/lot expiré.
          const lots=await tx.stockLot.findMany({where:{materialId:requested.materialId,status:"available",qty:{gt:0},OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},
            // P5.15.21 (FEFO-001) : « nulls:"last" » — en SQLite, ASC place les
            // NULL en tête : sans cette borne, les lots SANS péremption étaient
            // consommés avant les lots périssables, inversant le FEFO réel.
            orderBy:[{expiresAt:{sort:"asc",nulls:"last"}},{receivedAt:"asc"},{id:"asc"}]})
          const myReservations=await tx.salesStockReservation.findMany({where:{orderLineId:lineId}})
          const myByLot=new Map(myReservations.map(r=>[r.stockLotId,r]))
          // Priorité aux lots déjà réservés pour cette commande, puis FEFO libre.
          lots.sort((a,b)=>Number(myByLot.has(b.id))-Number(myByLot.has(a.id)))
          for(const lot of lots){
            if(remaining<=EPS)break
            const reserved=await reservedLotQty(tx,lot.id)
            const myReserved=myByLot.get(lot.id)?.qty??0
            const usable=stockFree(lot.qty,reserved)+myReserved
            const quantity=Math.round(Math.min(remaining,usable)*1000)/1000
            if(quantity<=0)continue
            if(!isValidStockQuantity(quantity,requested.stockUnit))throw Error("Quantité de lot non compatible avec son unité")
            // Consommer d'abord la réservation dans la MÊME transaction :
            // le garde-fou SQL du lot ne peut accepter un débit sous le stock réservé.
            const drawn=Math.min(quantity,myReserved)
            if(drawn>EPS){
              const mine=myByLot.get(lot.id)!
              if(mine.qty-drawn<=EPS)await tx.salesStockReservation.delete({where:{id:mine.id}})
              else await tx.salesStockReservation.update({where:{id:mine.id},data:{qty:{decrement:drawn}}})
            }
            const updated=await tx.stockLot.updateMany({where:{id:lot.id,status:"available",qty:{gte:quantity}},data:{qty:{decrement:quantity}}})
            if(updated.count!==1)throw Error("Stock concurrent ou insuffisant")
            await reducePlacement(tx,lot.id,quantity)
            const updatedMaterial=await tx.material.updateMany({where:{id:requested.materialId,stockQty:{gte:quantity}},data:{stockQty:{decrement:quantity}}})
            if(updatedMaterial.count!==1)throw Error("Incohérence stock matière")
            const movement=await tx.movement.create({data:{ref:await nextRef("MVT","movement",tx),type:"out",materialId:requested.materialId,
              stockLotId:lot.id,qty:quantity,signedQty:-quantity,unit:requested.stockUnit,
              reason:"Vente directe client",document:d.ref,operator:actor}})
            await tx.salesStockAllocation.create({data:{deliveryLineId:deliveryLine.id,stockLotId:lot.id,movementId:movement.id,qty:quantity,unit:requested.stockUnit}})
            consumed.push({lineId,lotId:lot.id,qty:quantity})
            remaining=Math.round((remaining-quantity)*1000)/1000
          }
          if(remaining>EPS)throw Error("Stock de négoce insuffisant ou réservé : BL annulé sans débit")
        }
        for(const [lineId,request] of finished){
          const deliveryLine=d.lines.find(l=>l.orderLineId===lineId)!
          const wo=workOrders.find(w=>w.orderLineId===lineId)
          let remaining=request.qty
          const lots=await tx.finishedStockLot.findMany({where:{productId:request.productId,status:"available",qty:{gt:0},
            OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},
            orderBy:[{expiresAt:{sort:"asc",nulls:"last"}},{receivedAt:"asc"},{id:"asc"}]})
          const bookings=lots.length?await tx.finishedStockReservation.findMany({where:{lotId:{in:lots.map(l=>l.id)}}}):[]
          const myByLot=new Map(bookings.filter(b=>b.orderLineId===lineId).map(b=>[b.lotId,b]))
          const reservedTotal=new Map<number,number>()
          for(const b of bookings)reservedTotal.set(b.lotId,(reservedTotal.get(b.lotId)??0)+b.qty)
          // Pour un OF « préparation stock », le BL ne peut prendre QUE les
          // lots affectés à cet OF. Pour un autre parcours, seulement le libre.
          if(wo?.preparationKind==="stock" &&
            [...myByLot.values()].reduce((n,b)=>n+b.qty,0)<remaining)
            throw Error("FINISHED_STOCK_RESERVATION_MISSING")
          lots.sort((a,b)=>Number(myByLot.has(b.id))-Number(myByLot.has(a.id)))
          for(const lot of lots){
            if(remaining<=0)break
            const mine=myByLot.get(lot.id)
            const own=mine?.qty??0
            const free=Math.max(0,lot.qty-(reservedTotal.get(lot.id)??0))
            const usable=wo?.preparationKind==="stock"?own:free
            const quantity=Math.min(remaining,usable)
            if(quantity<=0)continue
            // Libérer la quantité affectée et débiter le stock ENSEMBLE.
            if(wo?.preparationKind==="stock" && mine){
              if(mine.qty===quantity)await tx.finishedStockReservation.delete({where:{id:mine.id}})
              else await tx.finishedStockReservation.update({where:{id:mine.id},data:{qty:{decrement:quantity}}})
            }
            const changed=await tx.finishedStockLot.updateMany({where:{id:lot.id,status:"available",qty:{gte:quantity}},data:{qty:{decrement:quantity}}})
            if(changed.count!==1)throw Error("Concurrence ou insuffisance stock fini")
            await tx.finishedStockMovement.create({data:{ref:await ref(tx,"MFP"),lotId:lot.id,type:"out",qty:-quantity,document:d.ref,actor}})
            await tx.finishedStockAllocation.create({data:{deliveryLineId:deliveryLine.id,lotId:lot.id,qty:quantity}})
            consumed.push({lineId,lotId:lot.id,qty:quantity})
            remaining-=quantity
          }
          if(remaining!==0)throw Error("Stock fini insuffisant ou réservé : BL annulé sans débit")
        }
        const allDelivered=order.lines.every(l=>{
          const prior=sum(order.salesDeliveries.flatMap(d=>d.lines.filter(x=>x.orderLineId===l.id).map(x=>x.qty)))
          return prior+(buckets.get(l.id)?.qty??0)+1e-7>=l.qty
        })
        if(allDelivered)await tx.order.updateMany({where:{id:orderId,status:"ready"},data:{status:"shipped"}})
        await tx.auditEvent.create({data:audit(actor,"SALES_DELIVERY_POSTED","SalesDelivery",d.id,{orderId,pieceIds,stockLines,consumed})})
        return d
      }))
      return NextResponse.json({delivery},{status:201})
    }
    if(action==="invoice"){
      const parsed=invoiceSchema.safeParse(body);if(!parsed.success)return result("BL ou taux de taxe invalides")
      const {orderId,deliveryIds,taxRateBps}=parsed.data
      if(!salesTaxAllowed(taxRateBps,process.env.GOCMD_SALES_TAX_RATES_BPS))return result("Taux de TVA absent de la configuration SODEPI validée par la comptabilité",409)
      if(new Set(deliveryIds).size!==deliveryIds.length)return result("BL répété")
      const invoice=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        const order=await tx.order.findUniqueOrThrow({where:{id:orderId}})
        const deliveries=await tx.salesDelivery.findMany({where:{id:{in:deliveryIds},orderId,status:"posted"},include:{lines:{include:{orderLine:{include:{product:{select:{name:true,sku:true}}}},invoiceLine:true}}}})
        if(deliveries.length!==deliveryIds.length)throw new Error("BL introuvable ou autre commande")
        const lines=deliveries.flatMap(d=>d.lines)
        if(!lines.length||lines.some(l=>l.invoiceLine))throw new Error("BL déjà facturé, facturation répétée interdite")
        const toBill=lines.map(l=>({deliveryLineId:l.id,qty:l.qty,unit:l.unit,unitPriceCents:cents(l.orderLine.unitPrice),amountCents:cents(l.qty*l.orderLine.unitPrice),
          productNameSnapshot:l.productNameSnapshot??l.orderLine.productNameSnapshot??l.orderLine.product.name,
          productSkuSnapshot:l.productSkuSnapshot??l.orderLine.productSkuSnapshot??l.orderLine.product.sku}))
        const subtotalCents=sum(toBill.map(l=>l.amountCents))
        const taxCents=Math.round(subtotalCents*taxRateBps/10000)
        const totalCents=subtotalCents+taxCents
        if(!Number.isSafeInteger(totalCents)||totalCents>2_000_000_000)throw new Error("Montant trop élevé")
        const inv=await tx.salesInvoice.create({data:{ref:await ref(tx,"FAC"),orderId,clientId:order.clientId,
          clientNameSnapshot:(await tx.client.findUniqueOrThrow({where:{id:order.clientId}})).name,
          taxRateBps,subtotalCents,taxCents,totalCents,createdBy:actor,lines:{create:toBill}}})
        await tx.auditEvent.create({data:audit(actor,"SALES_INVOICE_ISSUED","SalesInvoice",inv.id,{orderId,deliveryIds,totalCents,taxRateBps})})
        return inv
      }))
      return NextResponse.json({invoice},{status:201})
    }
    if(["approve-credit","reject-credit","cancel-credit"].includes(action)){
      const parsed=creditDecisionSchema.safeParse(body);if(!parsed.success)return result("Décision sur avoir invalide")
      const d=parsed.data
      const credit=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        const cr=await tx.salesCreditNote.findUnique({where:{id:d.creditId}})
        if(!cr||cr.status!=="draft")throw new Error("Avoir déjà traité ou inexistant")
        if(d.action==="approve-credit"&&cr.actor===actor)throw new Error("Une autre personne doit approuver l’avoir client")
        if(d.action==="reject-credit"&&cr.actor===actor)throw new Error("Le préparateur doit annuler son brouillon, pas le rejeter")
        if(d.action==="cancel-credit"&&cr.actor!==actor)throw new Error("Seul le préparateur peut annuler le brouillon")
        const target=d.action==="approve-credit"?"approved":d.action==="reject-credit"?"rejected":"cancelled"
        if(d.action==="approve-credit"){
          const inv=await tx.salesInvoice.findUniqueOrThrow({where:{id:cr.invoiceId},include:{payments:true,credits:true}})
          const paid=sum(inv.payments.map(p=>p.amountCents))
          const approved=sum(inv.credits.filter(c=>c.status==="approved").map(c=>c.amountCents))
          if(cr.amountCents>inv.totalCents-paid-approved)throw new Error("Avoir supérieur au solde restant")
          const remaining=inv.totalCents-paid-approved-cr.amountCents
          // A credit without payment is still partial, not an untouched issued invoice.
          const touch=await tx.salesInvoice.updateMany({where:{id:inv.id,version:inv.version},data:{version:{increment:1},status:salesInvoiceStatus(remaining,paid,approved+cr.amountCents)}})
          if(touch.count!==1)throw new Error("Conflit de modification de facture")
        }
        if(d.action!=="approve-credit"){
          // Cancel/reject releases a draft reservation and bumps the invoice revision.
          const inv=await tx.salesInvoice.findUniqueOrThrow({where:{id:cr.invoiceId}})
          const touch=await tx.salesInvoice.updateMany({where:{id:inv.id,version:inv.version},data:{version:{increment:1}}})
          if(touch.count!==1)throw new Error("Conflit de modification de facture")
        }
        const changed=await tx.salesCreditNote.updateMany({where:{id:cr.id,status:"draft"},data:{status:target,decisionActor:actor,decisionReason:d.action==="approve-credit"?null:d.reason,decidedAt:new Date()}})
        if(changed.count!==1)throw new Error("Décision concurrente sur l’avoir")
        await tx.auditEvent.create({data:audit(actor,"SALES_CREDIT_"+target.toUpperCase(),"SalesCreditNote",cr.id,{invoiceId:cr.invoiceId,reason:d.action==="approve-credit"?null:d.reason})})
        return tx.salesCreditNote.findUniqueOrThrow({where:{id:cr.id}})
      }))
      return NextResponse.json({credit})
    }
    if(action==="credit-lines"){
      const parsed=creditLinesSchema.safeParse(body);if(!parsed.success)return result("Lignes d'avoir invalides",400)
      const {invoiceId,reason,lines}=parsed.data
      if(new Set(lines.map(l=>l.invoiceLineId)).size!==lines.length)return result("Ligne de facture répétée dans l'avoir",400)
      const created=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        const inv=await tx.salesInvoice.findUniqueOrThrow({where:{id:invoiceId},include:{payments:true,credits:true,lines:true}})
        const taxByLine=allocateInvoiceTax(inv.lines,inv.subtotalCents,inv.taxCents)
        const related=inv.lines.filter(l=>lines.some(x=>x.invoiceLineId===l.id))
        if(related.length!==lines.length)throw Error("Ligne d'avoir appartenant à une autre facture")
        const prior=await tx.salesCreditNoteLine.findMany({where:{invoiceLineId:{in:lines.map(l=>l.invoiceLineId)},creditNote:{status:{in:["draft","approved"]}}}})
        let total=0
        const allocations=[] as {invoiceLineId:number,qty:number,amountCents:number,taxCents:number}[]
        for(const request of lines){
          const original=related.find(l=>l.id===request.invoiceLineId)!
          if(!isValidPurchaseQuantity(request.qty,original.unit))throw Error("Quantité d'avoir incompatible avec l'unité de facturation")
          const earlier=prior.filter(x=>x.invoiceLineId===original.id)
          const alreadyQty=sum(earlier.map(x=>x.qty))
          const untaxed=partialLineCredit(original.amountCents,original.qty,request.qty,alreadyQty,sum(earlier.map(x=>x.amountCents)))
          const tax=partialLineCredit(taxByLine.get(original.id)??0,original.qty,request.qty,alreadyQty,sum(earlier.map(x=>x.taxCents)))
          const amount=untaxed+tax
          if(!Number.isSafeInteger(amount)||amount<=0)throw Error("Montant d'avoir invalide")
          total+=amount
          if(!Number.isSafeInteger(total)||total>2_000_000_000)throw Error("Montant d'avoir trop élevé")
          allocations.push({invoiceLineId:original.id,qty:request.qty,amountCents:untaxed,taxCents:tax})
        }
        const paid=sum(inv.payments.map(p=>p.amountCents))
        const reserved=sum(inv.credits.filter(c=>["draft","approved"].includes(c.status)).map(c=>c.amountCents))
        if(total>inv.totalCents-paid-reserved)throw Error("Avoir supérieur au solde non réservé")
        const changed=await tx.salesInvoice.updateMany({where:{id:inv.id,version:inv.version},data:{version:{increment:1}}})
        if(changed.count!==1)throw Error("Conflit de modification de facture")
        const cr=await tx.salesCreditNote.create({data:{ref:await ref(tx,"AVC"),invoiceId,amountCents:total,reason,actor,status:"draft",lines:{create:allocations}}})
        await tx.auditEvent.create({data:audit(actor,"SALES_CREDIT_LINES_DRAFTED","SalesCreditNote",cr.id,{invoiceId,amountCents:total,lines:allocations})})
        return cr
      }))
      return NextResponse.json({credit:created},{status:201})
    }
    if(action==="credit"||action==="payment"){
      if(action==="credit"){
        // RR-01: monetary credits without invoice-line evidence are an
        // accounting exception, not the default in a real SODEPI deployment.
        // Line-based credits continue through the standard four-eyes workflow.
        if(process.env.NODE_ENV==="production" && process.env.GOCMD_ALLOW_DEMO_DB!=="1" &&
           process.env.GOCMD_ALLOW_FREE_CLIENT_CREDITS!=="1")
          return result("Avoir monétaire libre désactivé : utiliser un avoir sur lignes de facture, ou obtenir une décision comptable explicite",409)
        const parsed=creditSchema.safeParse(body);if(!parsed.success)return result("Avoir invalide")
        const {invoiceId,amountCents,reason}=parsed.data
        const credit=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
          const inv=await tx.salesInvoice.findUniqueOrThrow({where:{id:invoiceId},include:{payments:true,credits:true}})
          const paid=sum(inv.payments.map(p=>p.amountCents))
          // Pending credits reserve capacity, without changing the invoice's financial balance.
          const reserved=sum(inv.credits.filter(c=>["draft","approved"].includes(c.status)).map(c=>c.amountCents))
          if(amountCents>inv.totalCents-paid-reserved)throw new Error("Avoir supérieur au solde non réservé")
          const touch=await tx.salesInvoice.updateMany({where:{id:inv.id,version:inv.version},data:{version:{increment:1}}})
          if(touch.count!==1)throw new Error("Conflit de modification de facture")
          const cr=await tx.salesCreditNote.create({data:{ref:await ref(tx,"AVC"),invoiceId,amountCents,reason,actor,status:"draft"}})
          await tx.auditEvent.create({data:audit(actor,"SALES_CREDIT_DRAFTED","SalesCreditNote",cr.id,{invoiceId,amountCents})})
          return cr
        }))
        return NextResponse.json({credit},{status:201})
      }
      const parsed=paymentSchema.safeParse(body);if(!parsed.success)return result("Paiement invalide")
      const {invoiceId,amountCents,reference,method}=parsed.data
      const payment=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        const inv=await tx.salesInvoice.findUniqueOrThrow({where:{id:invoiceId},include:{payments:true,credits:true}})
        // P5.15.21 (SEP-002) : quatre-yeux financiers — l'émetteur d'une
        // facture client ne peut pas enregistrer lui-même son règlement
        // (séparation création / encaissement, comme sur le circuit achats).
        if(inv.createdBy===actor)throw new Error("SELF_PAYMENT_FORBIDDEN")
        const approved=inv.credits.filter(c=>c.status==="approved")
        const remaining=inv.totalCents-sum(inv.payments.map(p=>p.amountCents))-sum(approved.map(c=>c.amountCents))
        // Reserve capacity for pending decisions. Otherwise a later approval may be impossible.
        const reserved=sum(inv.credits.filter(c=>c.status==="draft").map(c=>c.amountCents))
        if(remaining-reserved<amountCents)throw new Error("Sur-paiement ou solde réservé par des avoirs en attente")
        const touch=await tx.salesInvoice.updateMany({where:{id:inv.id,version:inv.version},data:{version:{increment:1},status:salesInvoiceStatus(remaining-amountCents,sum(inv.payments.map(p=>p.amountCents))+amountCents,sum(approved.map(c=>c.amountCents)))}})
        if(touch.count!==1)throw new Error("Conflit de modification de facture")
        const p=await tx.salesPayment.create({data:{invoiceId,amountCents,ref:reference,method,actor}})
        await tx.auditEvent.create({data:audit(actor,"SALES_PAYMENT_RECORDED","SalesPayment",p.id,{invoiceId,amountCents,method})})
        return p
      }))
      return NextResponse.json({payment},{status:201})
    }
  }catch(err){
    // P5.15.21 (SEP-002) : refus dédié et code 403 pour l'auto-encaissement,
    // distinct des conflits concurrentiels (409).
    if(err instanceof Error && err.message==="SELF_PAYMENT_FORBIDDEN")
      return result("L'émetteur d'une facture ne peut pas enregistrer son propre règlement : quatre yeux requis",403)
    if(action==="delivery" && typeof body?.requestKey==="string"){
      const prior=await db.salesDelivery.findUnique({where:{requestKey:body.requestKey}})
      const retry=deliverySchema.safeParse(body)
      if(prior && retry.success && prior.orderId===retry.data.orderId && prior.requestHash===createHash("sha256").update(JSON.stringify({orderId:retry.data.orderId,pieceIds:retry.data.pieceIds,stockLines:retry.data.stockLines,note:retry.data.note??null})).digest("hex"))return NextResponse.json({delivery:prior,idempotent:true})
    }
    console.error("Action commerciale GoCmd refusée",safeErrorMetadata(err))
    return result(err instanceof Error&&/Pièce|Quantité|BL |Commande|Devis|Avoir|avoir|Seul le préparateur|Décision|Sur-paiement|Métrage|Montant|déjà|non prête|hors commande|livrée|réglé|expiré|Transition/.test(err.message)?err.message:"Conflit de données : vérifier les documents et réessayer",409)
  }
  return result("Action inconnue")
}
