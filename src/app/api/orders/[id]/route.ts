import { safeErrorMetadata } from "@/lib/safe-server-error"
import { accessGate, currentActor, hasRole,hasPermission } from "@/lib/access-gate"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import {serializedSQLiteWrite} from "@/lib/sqlite-write"
import { nextOrderStatus } from "@/lib/erp-server"
import { isSameAuthorizedPrice } from "@/lib/special-price"
import { productDtoForActor } from "@/lib/product-dto"
import { createMissingWorkOrders, lineRequiresWorkOrder } from "@/lib/work-order-create"
import { requireDirectorPriceConfirmation } from "@/lib/sensitive-confirmation"

export const dynamic = "force-dynamic"

const ReviewSchema=z.object({
  action:z.enum(["approve","reject"]),
  comment:z.string().trim().max(1500),
}).strict()
// V18.9 : le champ « reviewer » n'est plus exigé — la décision est attribuée au
// compte connecté (revue « P3-3 »). L'interface n'envoie plus ce champ ; l'exiger
// ici faisait échouer toute validation de commande (400 systématique).
const include={client:true,lines:{include:{product:true,pieces:{orderBy:{sequence:"asc" as const}}}}} as const

/** C4-05 (contre-audit CASCADE4) : les champs internes d'idempotence et de
 * contrôle de doublons ne quittent jamais le serveur, y compris dans les
 * réponses de mutation (même règle que GET /api/orders). */
function stripInternal<T extends {createRequestKey?:unknown;createRequestDigest?:unknown;customerOrderNoNormalized?:unknown}>(o:T):Omit<T,"createRequestKey"|"createRequestDigest"|"customerOrderNoNormalized">{
  const {createRequestKey:_k,createRequestDigest:_d,customerOrderNoNormalized:_n,...safe}=o
  void _k;void _d;void _n
  return safe
}

/** R11 PERF-01 : détail chargé à la demande, jamais pour chaque carte de liste.
 * La permission est identique à GET /api/orders (rôles ET droit clients.read).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied=accessGate(req)
  if(denied)return denied
  const actor=currentActor(req)
  const allowed=actor&&!actor.legacy&&actor.roles.some(r=>["sales","approver","finance","director"].includes(r))&&
    (!actor.managed || hasPermission(req,"clients.read"))
  if(!allowed)return NextResponse.json({error:"Lecture des commandes réservée aux rôles habilités"},{status:403})
  const {id}=await ctx.params
  const oid=Number(id)
  if(!Number.isSafeInteger(oid)||oid<=0)return NextResponse.json({error:"Identifiant invalide"},{status:400})
  const order=await db.order.findUnique({where:{id:oid},include})
  if(!order)return NextResponse.json({error:"Commande introuvable"},{status:404})
  return NextResponse.json({order:{...stripInternal(order),
    lines:order.lines.map(l=>({...l,product:productDtoForActor(l.product,actor)})),
    total:order.lines.reduce((sum,l)=>sum+l.qty*l.unitPrice,0),
    dueDate:order.dueDate?.toISOString()??null,createdAt:order.createdAt.toISOString(),
  }},{headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}})
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = accessGate(req)
  if (denied) return denied





  const actorIdentity=currentActor(req)
  if (!actorIdentity) return NextResponse.json({error:"Session expirée ou compte indisponible"},{status:401})
  const actor=actorIdentity.username
  const {id}=await ctx.params
  const oid=Number(id)
  if(!Number.isInteger(oid)||oid<=0) return NextResponse.json({error:"Identifiant invalide"},{status:400})
  const body=await req.json().catch(()=>null)
  if(["hold","resume","close"].includes(body?.action)){
    if(!hasRole(req,"sales") || (actorIdentity.managed && !hasPermission(req,"sales.orders")))
      return NextResponse.json({error:"Rôle commercial et permission commandes requis"},{status:403})
    const reason=typeof body?.reason==="string"?body.reason.trim():""
    if(reason.length<10||reason.length>500)return NextResponse.json({error:"Motif de 10 à 500 caractères obligatoire"},{status:400})
    const from=body.action==="resume"?"on_hold":"open"
    const to=body.action==="hold"?"on_hold":body.action==="close"?"closed":"open"
    try {
      const order=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        const o=await tx.order.findUniqueOrThrow({where:{id:oid},include:{lines:{select:{id:true}},salesDeliveries:true}})
        if(o.fulfillmentStatus!==from||["shipped","rejected","pending_validation"].includes(o.status))throw Error("FULFILLMENT_CONFLICT")
        const updated=await tx.order.updateMany({where:{id:oid,fulfillmentStatus:from},data:{fulfillmentStatus:to,fulfillmentReason:reason,fulfillmentActor:actor,fulfillmentChangedAt:new Date()}})
        if(updated.count!==1)throw Error("FULFILLMENT_CONFLICT")
        // Suspendre/clôturer libère explicitement les réservations non expédiées.
        if(to!=="open"){
          await tx.salesStockReservation.deleteMany({where:{orderLineId:{in:o.lines.map(l=>l.id)}}})
          // Les matelas libérés ne doivent PAS rester déclarés préparés.
          await tx.finishedStockReservation.deleteMany({where:{orderLineId:{in:o.lines.map(l=>l.id)}}})
          await tx.workOrder.updateMany({where:{orderId:oid,status:"completed",preparationKind:"stock"},
            data:{status:"approved",preparationKind:null,completedBy:null,completedAt:null}})
        }
        await tx.auditEvent.create({data:{actor,action:"CUSTOMER_ORDER_"+body.action.toUpperCase(),entity:"Order",entityId:String(oid),details:JSON.stringify({from,to,reason})}})
        return tx.order.findUniqueOrThrow({where:{id:oid},include})
      }))
      const a=actorIdentity
      return NextResponse.json({order:{...stripInternal(order),lines:order.lines.map(l=>({...l,product:productDtoForActor(l.product,a)})),total:order.lines.reduce((t,l)=>t+l.qty*l.unitPrice,0)}})
    }catch{return NextResponse.json({error:"Transition impossible : commande modifiée ou état incompatible"},{status:409})}
  }
  if(body?.action==="advance"){
    if(actorIdentity.managed && !hasPermission(req,"sales.orders"))return NextResponse.json({error:"Permission commandes désactivée"},{status:403})
    if(!hasRole(req,"sales"))return NextResponse.json({error:"Rôle commercial requis"},{status:403})
    const order=await db.order.findUnique({where:{id:oid},include:{lines:{include:{product:true}}}})
    if(!order) return NextResponse.json({error:"Commande introuvable"},{status:404})
    if(order.fulfillmentStatus!=="open")return NextResponse.json({error:"Commande suspendue ou clôturée"},{status:409})
    // Barrière serveur : approbation commerciale effective, nominative et quatre yeux.
    if(!order.reviewedAt || !order.reviewedBy || (order.createdBy && order.reviewedBy===order.createdBy))
      return NextResponse.json({error:"Commande non approuvée par un responsable indépendant"},{status:409})
    if(["pending_validation","rejected"].includes(order.status) || order.lines.some(l=>l.priceApprovalStatus==="pending" || l.product.status!=="active" || (l.product.specialNotes && (l.product.specialPriceStatus!=="approved" || !isSameAuthorizedPrice(l.unitPrice,l.product.specialApprovedUnitPrice)))))
      return NextResponse.json({error:"Commande ou produit non validé : lancement en production interdit"},{status:409})
    if(order.status==="ready"){
      const prior=await db.salesDelivery.findMany({where:{orderId:oid},include:{lines:true}})
      const shippedIds=new Set(prior.flatMap(d=>d.lines.flatMap(l=>JSON.parse(l.pieceIds) as number[])))
      const allIds=(await db.orderPiece.findMany({where:{orderLine:{orderId:oid}},select:{id:true}})).map(p=>p.id)
      const lines=await db.orderLine.findMany({where:{orderId:oid},include:{product:true}})
      const allDelivered=lines.every(l=>{
        const qty=prior.flatMap(d=>d.lines).filter(row=>row.orderLineId===l.id).reduce((a,row)=>a+row.qty,0)
        return qty+1e-7>=l.qty
      })
      if(!allDelivered || allIds.some(id=>!shippedIds.has(id)))return NextResponse.json({error:"Livraison incomplète : émettre les BL clients avant expédition"},{status:409})
    }
    const next=nextOrderStatus(order.status)
    if(!next) return NextResponse.json({error:"Transition de statut interdite"},{status:409})
    let updated
    try {
      // P5.15.21 (CONC-002) : transition d'état de commande — mutation sensible
      // passée dans la file d'écriture sérialisée, comme hold/resume/close.
      updated=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        // OF-001 : la vente ne doit pas passer en fabrication sans OF approuvés.
        // OF-002 : commande prête uniquement si tous les OF de fabrication sont clos.
        // Les lignes de négoce n'ont pas d'OF et restent gérées par le stock.
        if(next==="production" || next==="ready"){
          const lines=await tx.orderLine.findMany({where:{orderId:oid},include:{product:true,pieces:{select:{id:true}},workOrder:true}})
          const toMake=lines.filter(l=>l.product.materialId==null && l.pieces.length>0 &&
            lineRequiresWorkOrder(l.kind,l.technicalSnapshotJson))
          // Les OF fabriqués gardent leur cycle de fabrication. Les ordres
          // de préparation des articles revendus sont contrôlés à la livraison.
          // Compatibilité documentée pour les commandes anciennes sans OF.
          const enforce=process.env.GOCMD_REQUIRE_OF_FOR_PRODUCTION==="1" || toMake.some(l=>l.workOrder!=null)
          if(enforce && toMake.some(l=>!l.workOrder ||
            (next==="production" ? !["approved","in_progress","completed"].includes(l.workOrder.status) : l.workOrder.status!=="completed")))
            throw new Error(next==="production"?"WORK_ORDERS_NOT_APPROVED":"WORK_ORDERS_NOT_COMPLETED")
        }
        const changed=await tx.order.updateMany({where:{id:oid,status:order.status,fulfillmentStatus:"open"},data:{status:next}})
        if(changed.count!==1)throw new Error("CONFLICT")
        await tx.auditEvent.create({data:{actor,action:"CUSTOMER_ORDER_ADVANCED",entity:"Order",entityId:String(oid),details:JSON.stringify({from:order.status,to:next})}})
        return tx.order.findUniqueOrThrow({where:{id:oid},include})
      }))
    } catch(e) {
      if(e instanceof Error && e.message==="WORK_ORDERS_NOT_APPROVED")
        return NextResponse.json({error:"Créer et approuver un OF pour chaque ligne fabriquée avant le lancement"},{status:409})
      if(e instanceof Error && e.message==="WORK_ORDERS_NOT_COMPLETED")
        return NextResponse.json({error:"Tous les OF fabriqués doivent être terminés avant de déclarer la commande prête"},{status:409})
      return NextResponse.json({error:"La commande a été modifiée, actualisez"},{status:409})
    }
    // V18.9.9 (SEC-PROD-01) : DTO produit par permission dans la réponse.
    const a=actorIdentity
    return NextResponse.json({order:{...stripInternal(updated),lines:updated.lines.map(l=>({...l,product:productDtoForActor(l.product,a)})),total:updated.lines.reduce((t,l)=>t+l.qty*l.unitPrice,0)}})
  }
  // Prix hors catalogue : visa DIRECTEUR, sur les lignes de CETTE commande,
  // sans changer le tarif public ni autoriser une autre commande.
  if(body?.action==="approve-prices" || body?.action==="reject-prices"){
    if(!hasRole(req,"director") || (actorIdentity.managed && !hasPermission(req,"director.prices")))
      return NextResponse.json({error:"Validation tarifaire réservée au directeur habilité"},{status:403})
    // V2: a price approval belongs to ONE order line, never to a whole basket.
    const lineId=body?.lineId
    if(!Number.isSafeInteger(lineId)||lineId<=0)
      return NextResponse.json({error:"Sélectionner une ligne de prix exceptionnelle (lineId)"},{status:400})
    const reason=typeof body.reason==="string"?body.reason.trim():""
    if(reason.length<8||reason.length>500)return NextResponse.json({error:"Motif de 8 à 500 caractères obligatoire"},{status:400})
    if(body.action==="approve-prices"){
      const deniedConfirmation=await requireDirectorPriceConfirmation(req,body.sensitivePassword)
      if(deniedConfirmation)return deniedConfirmation
    }
    try {
      const updated=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
        const order=await tx.order.findUniqueOrThrow({where:{id:oid},include:{lines:{include:{product:true}}}})
        if(order.status!=="pending_validation"||order.fulfillmentStatus!=="open")throw Error("INVALID_STATE")
        if(order.createdBy===actor)throw Error("SELF_REVIEW_FORBIDDEN")
        const pending=order.lines.filter(l=>l.id===lineId && l.priceApprovalStatus==="pending")
        if(pending.length!==1)throw Error("PRICE_LINE_NOT_PENDING")
        if(body.action==="reject-prices"){
          const count=await tx.order.updateMany({where:{id:oid,status:"pending_validation"},data:{status:"rejected",reviewedBy:actor,reviewedAt:new Date(),reviewComment:reason}})
          if(count.count!==1)throw Error("CONFLICT")
          await tx.auditEvent.create({data:{actor,action:"CUSTOMER_ORDER_PRICE_REJECTED",entity:"Order",entityId:String(oid),details:JSON.stringify({reason,lines:pending.map(l=>l.id)})}})
        } else {
          const when=new Date()
          for(const line of pending){
            if(line.product.status!=="active")throw Error("PRODUCT_NOT_APPROVED")
            await tx.orderLine.update({where:{id:line.id},data:{priceApprovalStatus:"approved",priceApprovedBy:actor,priceApprovedAt:when,priceApprovalReason:reason}})
          }
          await tx.auditEvent.create({data:{actor,action:"CUSTOMER_ORDER_PRICE_APPROVED",entity:"Order",entityId:String(oid),details:JSON.stringify({reason,lines:pending.map(l=>l.id)})}})
          // Le visa du directeur approuve UNIQUEMENT les prix.
          // La commande reste en attente de l'approbation commerciale distincte
          // par un responsable habilité ; aucun OF n'est créé ici.
        }
        return tx.order.findUniqueOrThrow({where:{id:oid},include})
      }))
      const a=actorIdentity
      return NextResponse.json({order:{...stripInternal(updated),lines:updated.lines.map(l=>({...l,product:productDtoForActor(l.product,a)})),total:updated.lines.reduce((t,l)=>t+l.qty*l.unitPrice,0)}})
    }catch(e){
      if(e instanceof Error&&e.message==="SELF_REVIEW_FORBIDDEN")return NextResponse.json({error:"Le créateur ne peut pas approuver son propre tarif"},{status:403})
      return NextResponse.json({error:"Décision tarifaire refusée : prix, produit ou état non conforme"},{status:409})
    }
  }
  if(actorIdentity.managed && !hasPermission(req,"sales.approve"))return NextResponse.json({error:"Permission de validation désactivée"},{status:403})
  if(!hasRole(req,"approver"))return NextResponse.json({error:"Rôle validateur requis"},{status:403})
  const parsed=ReviewSchema.safeParse(body)
  if(!parsed.success) return NextResponse.json({error:"Décision invalide : action ou commentaire non conforme"},{status:400})
  const {action,comment}=parsed.data
  // P5.15.29 : aucune clé commune. Identité/session, rôle, permission et
  // quatre-yeux sont revérifiés côté serveur dans le circuit de décision.
  if(action==="reject" && comment.length<5) return NextResponse.json({error:"Motif de refus obligatoire (5 caractères minimum)"},{status:400})
  try{
    // P5.15.21 (CONC-002) : décision d'approbation — mutation sensible passée
    // dans la file d'écriture sérialisée (avance/approbation étaient les deux
    // dernières transitions de commande hors file).
    const updated=await serializedSQLiteWrite(()=>db.$transaction(async(tx)=>{
      // updateMany conditionnel : une commande ne peut être approuvée deux fois en parallèle.
      // Un approbateur classique n'est PAS habilité à accepter le prix.
      const pending=await tx.order.findUniqueOrThrow({where:{id:oid},include:{lines:{include:{product:true}}}})
      // P5.15.21 (SEP-001) : quatre-yeux sur les commandes clients — le
      // créateur d'une commande ne peut pas la valider lui-même. C'était le
      // seul circuit de documents sans double contrôle (BC/BR/RF/factures en
      // avaient déjà un). Commandes historiques (createdBy NULL) : garde inactive.
      if(action==="approve" && pending.createdBy!=null && pending.createdBy===actor)
        throw new Error("SELF_REVIEW_FORBIDDEN")
      if(action==="approve" && pending.lines.some(l=>l.priceApprovalStatus==="pending"))throw new Error("DIRECTOR_PRICE_REQUIRED")
      if(action==="approve" && pending.lines.some(l=>l.product.specialNotes && (
        l.product.specialPriceStatus!=="approved" || !l.product.specialPriceApprovedBy ||
        !isSameAuthorizedPrice(l.unitPrice,l.product.specialApprovedUnitPrice))))
        throw new Error("DIRECTOR_PRICE_REQUIRED")
      if(pending.status!=="pending_validation" || pending.fulfillmentStatus!=="open")throw Error("ORDER_NOT_PENDING")
      const changed=await tx.order.updateMany({where:{id:oid,status:"pending_validation",fulfillmentStatus:"open"},data:{
        status:action==="approve"?(pending.lines.every(l=>l.product.materialId!=null || !lineRequiresWorkOrder(l.kind,l.technicalSnapshotJson))?"ready":"new"):"rejected",reviewComment:comment||null,reviewedBy:actor,reviewedAt:new Date()}})
      if(changed.count!==1) throw new Error("Commande déjà traitée ou introuvable")
      const order=await tx.order.findUniqueOrThrow({where:{id:oid},include:{lines:true}})
      const ids=order.lines.map(l=>l.productId)
      await tx.product.updateMany({where:{id:{in:ids},status:"pending_validation"},data:{status:action==="approve"?"active":"rejected"}})
      await tx.auditEvent.create({data:{actor,action:action==="approve"?"CUSTOMER_ORDER_APPROVED":"CUSTOMER_ORDER_REJECTED",entity:"Order",entityId:String(oid),details:JSON.stringify({comment,productIds:ids})}})
      // Cas produit spécial : l'approbation rend la commande validée et
      // émet tous les OF dans la même transaction (aucun OF en cas de refus).
      if (action === "approve") await createMissingWorkOrders(tx, oid, actor)
      return tx.order.findUniqueOrThrow({where:{id:oid},include})
    }))
    // V18.9.9 (SEC-PROD-01) : DTO produit par permission dans la réponse.
    const a=actorIdentity
    return NextResponse.json({order:{...stripInternal(updated),lines:updated.lines.map(l=>({...l,product:productDtoForActor(l.product,a)})),total:updated.lines.reduce((t,l)=>t+l.qty*l.unitPrice,0)}})
  }catch(e){
    // P5.15.21 (SEP-001) : message dédié et code 403 pour l'auto-validation,
    // distinct des conflits concurrentiels (409).
    if(e instanceof Error && e.message==="SELF_REVIEW_FORBIDDEN")
      return NextResponse.json({error:"Auto-validation interdite : le créateur d'une commande ne peut pas la valider lui-même (quatre yeux)"},{status:403})
    console.error("Validation commande échouée",safeErrorMetadata(e));return NextResponse.json({error:e instanceof Error&&e.message==="DIRECTOR_PRICE_REQUIRED"?"Prix spécial : approbation explicite du directeur obligatoire avant validation de la commande":"Validation impossible : commande déjà traitée ou conflit, actualisez"},{status:409})}
}
