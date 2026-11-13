import { safeErrorMetadata } from "@/lib/safe-server-error"
import {assertStockUnreserved} from "@/lib/sales-stock-reservation"
import { isValidStockQuantity } from "@/lib/stock-quantity"
import { increasePlacement, reducePlacement } from "@/lib/p2p-placements"
import { accessGate, currentActor, hasRole, hasAnyReadRole, hasPermission } from "@/lib/access-gate"
import { serializedSQLiteWrite } from "@/lib/sqlite-write"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { nextRef } from "@/lib/erp-server"
export const dynamic="force-dynamic"
/** C4-04 (contre-audit CASCADE4) : la consultation des mouvements applique la
 * matrice « stock.read » côté serveur, comme GET /api/stock-lots. Le compte démo
 * partagé conserve la lecture démonstration ; l'opérateur reste masqué hors
 * rôles privilégiés (RR-18). */
const STOCK_READ_ROLES=["buyer","approver","receiver","inventory","quality","finance","director"] as const
const Schema=z.object({type:z.enum(["in","out","adjust"]),materialId:z.number().int().positive(),stockLotId:z.number().int().positive().optional(),qty:z.number().finite().min(-1_000_000).max(1_000_000),reason:z.string().trim().min(2).max(200),operator:z.string().optional(),exceptionalReceipt:z.boolean().optional(),deliveryRef:z.string().optional()})
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied
 const actor=currentActor(req)
 if(actor&&!actor.legacy&&(!hasAnyReadRole(req,[...STOCK_READ_ROLES]) || (actor.managed&&!hasPermission(req,"stock.read"))))
   return NextResponse.json({error:"Lecture des mouvements réservée aux rôles habilités (stock.read)"},{status:403})
 const sp=req.nextUrl.searchParams, type=sp.get("type")??"all",q=(sp.get("q")??"").trim()
 const archive=sp.get("archive")==="legacy"
 const take=Math.min(200,Math.max(1,Number(sp.get("take")??(archive?200:120))||120))
 const movements=await db.movement.findMany({where:{AND:[{isArchived:archive},type==="all"?{}:{type},q?{OR:[{reason:{contains:q}},{document:{contains:q}},{ref:{contains:q}},{operator:{contains:q}}]}:{}]},include:{material:true,stockLot:true},orderBy:{createdAt:"desc"},take})
 // RR-18: operator names are personal data, not needed for commercial
 // read-only views; the full audit remains available to authorized staff.
 const canReadOperators=["admin","inventory","approver","buyer","finance"].some(role=>hasRole(req,role as "admin"|"inventory"|"approver"|"buyer"|"finance"))
 return NextResponse.json({items:movements.map(m=>({...m,operator:canReadOperators?m.operator:null,createdAt:m.createdAt.toISOString(),material:m.material?{ref:m.material.ref,name:m.material.name,category:m.material.category}:null}))},{headers:{"Cache-Control":"private, no-store","Vary":"Cookie, Authorization"}})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req,"inventory");if(denied)return denied
 const actor=currentActor(req)!.username
 const parsed=Schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Mouvement invalide",details:parsed.error.flatten()},{status:400})
 const d=parsed.data
 if(d.type==='adjust')return NextResponse.json({error:'Ajustement direct désactivé. Utilisez un comptage inventaire et une approbation nominative distincte.'},{status:403})
 // A raw BOOL in the browser cannot approve a receipt outside BC. Separate workflow required.
 if(d.type==="in")return NextResponse.json({error:"Entrée hors BC bloquée. Utilisez une réception fournisseur contrôlée (BR)"},{status:403})
 if(d.qty<=0)return NextResponse.json({error:"Quantité invalide"},{status:400})
 if(!d.stockLotId)return NextResponse.json({error:"Lot physique obligatoire pour les sorties et ajustements"},{status:400})
 try{
  const result=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
   // Audit 10/11/2026 (CONC-MVT-01) : verrou d'écriture AVANT la lecture du
   // lot (même convention que reserve-stock et prepare-OF). En multi-processus,
   // assertStockUnreserved calculait sur un lot.qty lu en snapshot différé :
   // le trigger gocmd_p5154_lot_reserved_guard reste le dernier rempart, mais
   // la file locale ne sérialise qu'un seul processus — l'upsert de compteur
   // sérialise aussi les écritures concurrentes d'un AUTRE processus.
   await tx.salesDocCounter.upsert({where:{id:"GOCMD_STOCK_MOVEMENT_LOCK"},create:{id:"GOCMD_STOCK_MOVEMENT_LOCK",value:1},update:{value:{increment:1}}})
   const lot=await tx.stockLot.findUnique({where:{id:d.stockLotId!},include:{material:{select:{unit:true}}}})
   if(!lot||lot.materialId!==d.materialId||lot.status!=="available"||(lot.expiresAt!==null&&lot.expiresAt<=new Date()))throw new Error("LOT_UNAVAILABLE")
   if(!isValidStockQuantity(d.qty,lot.material.unit))throw new Error("INVALID_UNIT_QTY")
   await assertStockUnreserved(tx,lot.id,lot.qty,d.qty)
   const delta=d.type==="out"?-d.qty:d.qty
   const amount=await tx.stockLot.updateMany({where:{id:lot.id,status:"available",qty:{gte:Math.max(0,-delta)}},data:{qty:{increment:delta}}})
   if(amount.count!==1)throw new Error("INSUFFICIENT_STOCK")
   if(delta<0)await reducePlacement(tx,lot.id,-delta)
   if(delta>0)await increasePlacement(tx,lot.id,delta)
   const material=await tx.material.updateMany({where:{id:d.materialId,stockQty:{gte:Math.max(0,-delta)}},data:{stockQty:{increment:delta}}})
   if(material.count!==1)throw new Error("INSUFFICIENT_STOCK")
   const mat=await tx.material.findUniqueOrThrow({where:{id:d.materialId}})
   const ref=await nextRef("MVT","movement",tx)
   await tx.movement.create({data:{ref,type:d.type,materialId:d.materialId,stockLotId:lot.id,qty:Math.abs(d.qty),signedQty:delta,unit:mat.unit,reason:d.reason,operator:actor}})
   await tx.auditEvent.create({data:{actor,action:d.type==="out"?"STOCK_ISSUED":"STOCK_ADJUSTED",entity:"StockLot",entityId:String(lot.id),details:JSON.stringify({ref,delta,reason:d.reason})}})
   return {ref,stock:mat.stockQty,lotRemaining:lot.qty+delta}
  }))
  return NextResponse.json(result,{status:201})
 }catch(e){const code=e instanceof Error?e.message:"";if(code!=="LOT_UNAVAILABLE"&&code!=="INSUFFICIENT_STOCK"&&code!=="INVALID_UNIT_QTY")console.error("[movements] erreur non mappée:",safeErrorMetadata(e));return NextResponse.json({error:code==="INVALID_UNIT_QTY"?"Quantité incompatible avec l’unité du lot":code==="LOT_UNAVAILABLE"?"Lot indisponible, bloqué ou absent":"Stock insuffisant, lot modifié ou opération concurrente"},{status:code==="INVALID_UNIT_QTY"?400:409})}
}
