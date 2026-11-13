import {readDocumentPage,documentPagination} from "@/lib/document-register"
import { accessGate, currentActor, hasPermission, hasRole, hasAnyReadRole } from "@/lib/access-gate"
import { db } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"
/** C4-03 (contre-audit CASCADE4) : matrice « stock.read » appliquée côté serveur,
 * comme documentée dans ROLES_ET_PERMISSIONS.md (§ stock.read). Le compte démo
 * partagé (legacy) conserve sa lecture démonstration locale, sans données qualité.
 * Les enregistrements QualityInspection sont sérialisés en DTO minimal : l'acteur
 * (donnée personnelle, doctrine RR-18 identique à GET /api/movements) et le motif
 * détaillé restent dans le circuit qualité dédié /api/quality-inspections. */
const STOCK_READ_ROLES=["buyer","approver","receiver","inventory","quality","finance","director"] as const
type InspectionRaw={id:number;decision:string;qty:number;createdAt:Date;actor:string;reason:string;[k:string]:unknown}
function inspectionDto(list:InspectionRaw[]|undefined){
  return (list??[]).map(i=>({id:i.id,decision:i.decision,qty:i.qty,createdAt:i.createdAt}))
}
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 const actor=currentActor(req)
 // C4-03 : un compte nominatif sans rôle de la matrice stock.read (ex. sales,
 // production) n'accède plus aux lots physiques et aux décisions qualité.
 if(actor&&!actor.legacy&&(!hasAnyReadRole(req,[...STOCK_READ_ROLES]) || (actor.managed&&!hasPermission(req,"stock.read"))))
   return NextResponse.json({error:"Lecture des lots réservée aux rôles habilités (stock.read)"},{status:403})
 const m=Number(req.nextUrl.searchParams.get("materialId")||0)
 const params=req.nextUrl.searchParams
 const register=params.get("view")==="register"
 const {page,pageSize,q,take,skip}=readDocumentPage(params)
 const status=params.get("status")
 const where={
  ...(m>0?{materialId:m}:{}),
  ...(status&&["available","quarantine","returned","legacy_unverified"].includes(status)?{status}:{}),
  ...(q?{OR:[{lotCode:{contains:q}},{material:{OR:[{name:{contains:q}},{ref:{contains:q}}]}}]}:{}),
 }
 const dir=params.get("dir")==="asc"?"asc":"desc"
 const sort=params.get("sort")
 const [items,total]=await Promise.all([
  db.stockLot.findMany({where,include:{material:{select:{id:true,ref:true,name:true,unit:true}},inspection:{orderBy:{createdAt:"desc"},take:2}},
   orderBy:[sort==="matiere"?{material:{name:dir}}:sort==="qty"?{qty:dir}:{receivedAt:"desc"},{id:"desc"}],take:register?take:200,skip:register?skip:0}),
  register?db.stockLot.count({where}):Promise.resolve(0),
 ])
 if(register)return NextResponse.json({items:items.map(l=>({...l,inspection:inspectionDto(l.inspection)})),pagination:documentPagination(page,pageSize,total)})
 const now=new Date()
 const eligible={materialId:m,status:"available",qty:{gt:0}} as const
 // Compute FEFO from the whole material stock, not just the 200 most recent lots.
 const expiresFirst=m>0?await db.stockLot.findFirst({where:{...eligible,expiresAt:{gt:now}},orderBy:[{expiresAt:"asc"},{receivedAt:"asc"},{id:"asc"}]}):null
 const fifoFirst=m>0&&!expiresFirst?await db.stockLot.findFirst({where:{...eligible,expiresAt:null},orderBy:[{receivedAt:"asc"},{id:"asc"}]}):null
 const recommended=expiresFirst??fifoFirst
 const visible=recommended&&!items.some(l=>l.id===recommended.id)?[recommended,...items.slice(0,199)]:items
 // Démarrage simple SODEPI : indiquer au magasinier où se trouve le lot,
 // sans imposer étiquettes ni scanner. Ne pas exposer les emplacements aux
 // utilisateurs sans rôle magasin et permission de lecture du stock.
 const canReadPlaces=hasRole(req,"inventory") &&
   (!currentActor(req)?.managed || hasPermission(req,"stock.read"))
 const placements=canReadPlaces&&m>0&&visible.length?await db.stockPlacement.findMany({
   where:{stockLotId:{in:visible.map(l=>l.id)},qty:{gt:0}},
   include:{location:{include:{warehouse:true}}},orderBy:{id:"asc"}
 }):[]
 const byLot=new Map<number,Array<{zone:string;name:string;qty:number}>>()
 for(const row of placements){
   const zones=byLot.get(row.stockLotId)??[]
   zones.push({zone:`${row.location.warehouse.code} / ${row.location.code}`,
     name:row.location.name,qty:row.qty})
   byLot.set(row.stockLotId,zones)
 }
 // V18.9.1 (contre-audit A-12) : l'alerte de péremption ne dépend plus de la
 // fenêtre d'affichage (200 lots) : requête dédiée sur l'ensemble du stock,
 // avec comptage exact et drapeau si la liste dépasse la garde technique.
 const expiredWhere={status:"available",qty:{gt:0},expiresAt:{lte:now},...(m>0?{materialId:m}:{})} as const
 const [expiredItems,expiredTotal]=await Promise.all([
  db.stockLot.findMany({where:expiredWhere,select:{id:true,lotCode:true,expiresAt:true},orderBy:{expiresAt:"asc"},take:1000}),
  db.stockLot.count({where:expiredWhere}),
 ])
 return NextResponse.json({items:visible.map(l=>{
   // C4-03 : le lot recommandé (findFirst sans include) n'a pas d'inspection ;
   // DTO minimal appliqué uniquement quand l'inspection est chargée.
   const raw=(l as {inspection?:InspectionRaw[]}).inspection
   return {...l,inspection:inspectionDto(raw),locations:byLot.get(l.id)??[]}
 }),recommendedLotId:recommended?.id??null,expiredLots:expiredItems,expiredLotsTotal:expiredTotal,expiredLotsTruncated:expiredTotal>expiredItems.length,policy:"FEFO avec repli FIFO; conseil uniquement, non prélèvement automatique"})
}
