import {NextRequest,NextResponse} from "next/server"
import {accessGate,currentActor,hasPermission,hasRole} from "@/lib/access-gate"
import {db} from "@/lib/db"
import {reservationExpiryPolicy} from "@/lib/reservation-expiry-policy"
export const dynamic="force-dynamic"
export async function GET(req:NextRequest){
 const denied=accessGate(req,"sales");if(denied)return denied
 if(!hasRole(req,"sales")||(currentActor(req)?.managed&&!hasPermission(req,"sales.deliveries")))return NextResponse.json({error:"Accès non autorisé"},{status:403})
 const orderId=Number(req.nextUrl.searchParams.get("orderId"))
 if(!Number.isSafeInteger(orderId)||orderId<1)return NextResponse.json({error:"orderId requis"},{status:400})
 const policy=reservationExpiryPolicy(process.env.GOCMD_RESERVATION_TTL_HOURS,process.env.GOCMD_RESERVATION_WARNING_HOURS)
 const [rows,finishedRows,order]=await Promise.all([
  db.salesStockReservation.findMany({where:{orderLine:{orderId}},select:{id:true,orderLineId:true,stockLotId:true,qty:true,createdAt:true,engagedAt:true,updatedAt:true},take:1001}),
  // RR-08: previously only raw materials were alerted; finished mattresses
  // could remain reserved forever without any warning to the operator.
  db.finishedStockReservation.findMany({where:{orderLine:{orderId}},select:{id:true,orderLineId:true,lotId:true,qty:true,createdAt:true,updatedAt:true},take:1001}),
  db.order.findUnique({where:{id:orderId},select:{dueDate:true,status:true}}),
 ])
 if(rows.length>1000||finishedRows.length>1000)return NextResponse.json({error:"Plus de 1000 réservations : consultation par lot nécessaire"},{status:413,headers:{"Cache-Control":"private,no-store"}})
 const now=Date.now()
 // P6 (2026-11-11), chantier 2 §3.3 : l'ancienneté et l'expiration se calculent
 // sur le DÉBUT D'ENGAGEMENT (engagedAt), jamais sur updatedAt — une
 // modification administrative ou une consommation partielle ne rajeunit pas
 // une réservation ancienne. Pour le stock fini, createdAt porte cette
 // sémantique (jamais modifié après création).
 const items=rows.map(r=>{
  const engagedAt=r.engagedAt??r.createdAt
  const expiry=policy.configured?new Date(engagedAt.getTime()+policy.ttlHours!*3600000):null
  const warningAt=policy.configured?new Date(engagedAt.getTime()+policy.warningHours!*3600000):null
  const remaining=expiry?expiry.getTime()-now:null
  return {id:r.id,orderLineId:r.orderLineId,stockLotId:r.stockLotId,qty:r.qty,
   createdAt:r.createdAt.toISOString(),
   engagedAt:engagedAt.toISOString(),
   lastModifiedAt:r.updatedAt.toISOString(),
   expectedDeliveryAt:order?.dueDate?.toISOString()??null,
   warningAt:warningAt?.toISOString()??null,
   expiresAt:expiry?.toISOString()??null,
   state:remaining===null?"not-configured":remaining<=0?"expired":remaining<=policy.warningHours!*3600000?"expiring-soon":"active"}
 })
 const finishedItems=finishedRows.map(r=>{
  const expiry=policy.configured?new Date(r.createdAt.getTime()+policy.ttlHours!*3600000):null
  const warningAt=policy.configured?new Date(r.createdAt.getTime()+policy.warningHours!*3600000):null
  const remaining=expiry?expiry.getTime()-now:null
  return {id:r.id,orderLineId:r.orderLineId,finishedLotId:r.lotId,qty:r.qty,
   createdAt:r.createdAt.toISOString(),
   engagedAt:r.createdAt.toISOString(),
   lastModifiedAt:r.updatedAt?.toISOString()??null,
   expectedDeliveryAt:order?.dueDate?.toISOString()??null,
   warningAt:warningAt?.toISOString()??null,
   expiresAt:expiry?.toISOString()??null,
   state:remaining===null?"not-configured":remaining<=0?"expired":remaining<=policy.warningHours!*3600000?"expiring-soon":"active"}
 })
 // Warnings only: NEVER automatically remove finished-stock reservations while
 // an OF is prepared. Release must re-open preparation and audit the change.
 return NextResponse.json({configured:policy.configured,ttlHours:policy.ttlHours,warningHours:policy.warningHours,orderStatus:order?.status??null,items,finishedItems}, {headers:{"Cache-Control":"private,no-store"}})
}
