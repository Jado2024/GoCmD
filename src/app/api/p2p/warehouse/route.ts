import { safeErrorMetadata } from "@/lib/safe-server-error"
import {assertStockUnreserved} from "@/lib/sales-stock-reservation"
import { isValidStockQuantity, isValidStockDelta, MAX_STOCK_QUANTITY } from '@/lib/stock-quantity';
import {accessGate,currentActor,hasAnyReadRole,hasPermission} from '@/lib/access-gate';
import {db} from '@/lib/db';
import {serializedSQLiteWrite} from '@/lib/sqlite-write';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {nextRef} from '@/lib/erp-server';
const S=z.discriminatedUnion('action',[
 z.object({action:z.literal('warehouse'),code:z.string().regex(/^[A-Z0-9_-]{2,24}$/),name:z.string().min(3).max(100)}),
 z.object({action:z.literal('location'),warehouseId:z.number().int().positive(),code:z.string().regex(/^[A-Z0-9_-]{2,24}$/),name:z.string().min(3).max(100)}),
 z.object({action:z.literal('transfer'),lotId:z.number().int().positive(),fromId:z.number().int().positive(),toId:z.number().int().positive(),qty:z.number().finite().positive().max(MAX_STOCK_QUANTITY),reason:z.string().min(5).max(300)}),
 z.object({action:z.literal('count'),lotId:z.number().int().positive(),locationId:z.number().int().positive(),observedQty:z.number().finite().min(0).max(MAX_STOCK_QUANTITY),reason:z.string().min(10).max(300)}),
 z.object({action:z.literal('approveCount'),countId:z.number().int().positive(),approved:z.boolean(),reason:z.string().min(10).max(300)})
]);
export async function GET(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied;
 // DMAIC AUD-02 : la localisation des lots et les comptages physiques
 // ne sont jamais lisibles par un simple compte connecté (ni par le rôle sales).
 if(!hasAnyReadRole(req,['buyer','approver','receiver','inventory','quality','finance','director']) ||
    (currentActor(req)?.managed && !hasPermission(req,'stock.read')))
  return NextResponse.json({error:'Lecture des dépôts et inventaires non autorisée'},{status:403,headers:{'Cache-Control':'no-store'}});
 const sp=req.nextUrl.searchParams;
 const page=Math.max(1,Math.min(1_000_000,Math.trunc(Number(sp.get('page')??1)||1)));
 const pageSize=Math.max(1,Math.min(200,Math.trunc(Number(sp.get('pageSize')??200)||200)));
 const [warehouses,placements,counts,placementTotal,countTotal]=await Promise.all([
  db.warehouseSite.findMany({include:{locations:true},orderBy:{code:'asc'}}),
  db.stockPlacement.findMany({include:{stockLot:{select:{lotCode:true,materialId:true,status:true,qty:true}},location:true},orderBy:{id:'asc'},skip:(page-1)*pageSize,take:pageSize}),
  db.stockCount.findMany({orderBy:[{countedAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize}),
  db.stockPlacement.count(),db.stockCount.count()]);
 return NextResponse.json({warehouses,placements,counts,pagination:{page,pageSize,placementTotal,countTotal,hasMorePlacements:page*pageSize<placementTotal,hasMoreCounts:page*pageSize<countTotal}})
}
export async function POST(req:NextRequest){
 const denied=accessGate(req);if(denied)return denied;
 const actor=currentActor(req)!.username;
 const parsed=S.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Opération de dépôt invalide',details:parsed.error.flatten()},{status:400});
 const d=parsed.data;
 const role=d.action==='approveCount'?'approver':'inventory';
 const allowed=accessGate(req,role);if(allowed)return allowed;
 const permission=d.action==="approveCount"?"stock.count.approve":d.action==="count"?"stock.count":"stock.move";
 if(currentActor(req)?.managed && !hasPermission(req,permission))return NextResponse.json({error:"Permission inventaire refusée"},{status:403});
 try{const result=await serializedSQLiteWrite(() => db.$transaction(async tx=>{
  let entity='Warehouse',id='';let value:unknown;
  if(d.action==='warehouse') {value=await tx.warehouseSite.create({data:{code:d.code,name:d.name}});id=String((value as {id:number}).id)}
  else if(d.action==='location'){const w=await tx.warehouseSite.findUnique({where:{id:d.warehouseId}});if(!w||!w.active)throw Error('DEPOT_INACTIF');value=await tx.storageLocation.create({data:{warehouseId:d.warehouseId,code:d.code,name:d.name}});id=String((value as {id:number}).id);entity='StorageLocation'}
  else if(d.action==='transfer'){
   if(d.fromId===d.toId)throw Error('MEME_EMPLACEMENT');
   const lot=await tx.stockLot.findUnique({where:{id:d.lotId},include:{material:{select:{unit:true}}}});if(!lot||!['available','quarantine','legacy_unverified'].includes(lot.status))throw Error('LOT_INDISPONIBLE');
   if(!isValidStockQuantity(d.qty,lot.material.unit))throw Error('INVALID_UNIT_QTY');
   const destination=await tx.storageLocation.findUnique({where:{id:d.toId},include:{warehouse:true}});if(!destination||destination.status!=='active'||!destination.warehouse.active)throw Error('DESTINATION_INACTIVE');
   const changed=await tx.stockPlacement.updateMany({where:{stockLotId:d.lotId,locationId:d.fromId,qty:{gte:d.qty}},data:{qty:{decrement:d.qty}}});if(changed.count!==1)throw Error('EMPLACEMENT_INSUFFISANT');
   await tx.stockPlacement.upsert({where:{stockLotId_locationId:{stockLotId:d.lotId,locationId:d.toId}},create:{stockLotId:d.lotId,locationId:d.toId,qty:d.qty},update:{qty:{increment:d.qty}}});
   value={lotId:d.lotId,transferred:d.qty};id=String(d.lotId);entity='StockLot';
  }else if(d.action==='count'){
   // Physical inventory is a pending count; another named approver reconciles it.
   const placement=await tx.stockPlacement.findUnique({where:{stockLotId_locationId:{stockLotId:d.lotId,locationId:d.locationId}},include:{stockLot:{include:{material:{select:{unit:true}}}}}});if(!placement)throw Error('EMPLACEMENT_ABSENT');
   if(!isValidStockQuantity(d.observedQty,placement.stockLot.material.unit,true))throw Error('INVALID_UNIT_QTY');
   const pending=await tx.stockCount.count({where:{lotId:d.lotId,locationId:d.locationId,status:'pending'}});if(pending)throw Error('COMPTAGE_DEJA_EN_COURS');
   value=await tx.stockCount.create({data:{lotId:d.lotId,locationId:d.locationId,expectedQty:placement.qty,observedQty:d.observedQty,reason:d.reason,countedBy:actor}});
   id=String((value as {id:number}).id);entity='StockCount';
  }else{
   const count=await tx.stockCount.findUnique({where:{id:d.countId},include:{lot:true}});
   if(!count||count.status!=='pending'||count.countedBy===actor)throw Error('DOUBLE_VALIDATION_REQUISE');
   // DMAIC AUD-03 : un comptage ancien aux quantités invalides doit pouvoir
   // être REJETÉ par un autre approbateur, sans jamais modifier les stocks.
   // La validation des unités reste stricte pour l'APPROBATION uniquement.
   if(!d.approved){value=await tx.stockCount.update({where:{id:count.id},data:{status:'rejected',approvedBy:actor,approvedAt:new Date(),reason:`${count.reason} | Rejet : ${d.reason}`}})}
   else{
    const countMaterial=await tx.material.findUnique({where:{id:count.lot.materialId},select:{unit:true}});
    if(!countMaterial||!isValidStockQuantity(count.observedQty,countMaterial.unit,true)||!isValidStockQuantity(count.expectedQty,countMaterial.unit,true)||!isValidStockDelta(count.observedQty-count.expectedQty,countMaterial.unit))throw Error('INVALID_UNIT_QTY');
    const delta=count.observedQty-count.expectedQty;
    // Contrôle exact AVANT écriture : un déplacement compensé ne peut pas être approuvé.
    const current=await tx.stockPlacement.findUnique({where:{stockLotId_locationId:{stockLotId:count.lotId,locationId:count.locationId}}});
    if(!current||Math.abs(current.qty-count.expectedQty)>1e-7)throw Error('STOCK_CHANGE_DEPUIS_COMPTAGE');
    if(delta<0 && count.lot.status==="available")await assertStockUnreserved(tx,count.lotId,count.lot.qty,-delta)
    const place=await tx.stockPlacement.updateMany({where:{stockLotId:count.lotId,locationId:count.locationId,qty:count.expectedQty},data:{qty:{increment:delta}}});
    if(place.count!==1)throw Error('STOCK_CHANGE_DEPUIS_COMPTAGE');
    const lot=await tx.stockLot.updateMany({where:{id:count.lotId,qty:{gte:Math.max(0,-delta)}},data:{qty:{increment:delta}}});if(lot.count!==1)throw Error('LOT_STOCK_CHANGE');
    if(['available','legacy_unverified'].includes(count.lot.status)){
     const mat=await tx.material.updateMany({where:{id:count.lot.materialId,stockQty:{gte:Math.max(0,-delta)}},data:{stockQty:{increment:delta}}});if(mat.count!==1)throw Error('MAT_STOCK_CHANGE');
     if(Math.abs(delta)>1e-8)await tx.movement.create({data:{ref:await nextRef('MVT','movement',tx),type:'adjust',materialId:count.lot.materialId,stockLotId:count.lotId,qty:Math.abs(delta),signedQty:delta,unit:countMaterial.unit,reason:`Inventaire #${count.id}: ${d.reason}`,operator:actor}})
    }
    value=await tx.stockCount.update({where:{id:count.id},data:{status:'approved',approvedBy:actor,approvedAt:new Date()}});
   }
   id=String(d.countId);entity='StockCount';
  }
  await tx.auditEvent.create({data:{actor,entity,entityId:id,action:`P2P_${d.action.toUpperCase()}`,details:JSON.stringify(d)}});return value;
 }));return NextResponse.json({result},{status:201})}
 catch(e){
  const code=e instanceof Error?e.message:'';
  const errors:Record<string,string>={DEPOT_INACTIF:'Dépôt inconnu ou inactif',MEME_EMPLACEMENT:'Emplacements identiques',LOT_INDISPONIBLE:'Lot indisponible',DESTINATION_INACTIVE:'Destination inactive',EMPLACEMENT_INSUFFISANT:'Quantité insuffisante sur cet emplacement',EMPLACEMENT_ABSENT:'Emplacement sans lot',COMPTAGE_DEJA_EN_COURS:'Un comptage est déjà en cours',DOUBLE_VALIDATION_REQUISE:'Comptage non validable par son auteur',STOCK_CHANGE_DEPUIS_COMPTAGE:'Stock modifié depuis le comptage : recommencer',LOT_STOCK_CHANGE:'Quantité du lot modifiée',MAT_STOCK_CHANGE:'Stock matière modifié',INVALID_UNIT_QTY:'Quantité incompatible avec l’unité de stock (bloc et pièces entiers, métrique à 3 décimales)',P2002:'Enregistrement déjà existant'};
  if(Object.prototype.hasOwnProperty.call(errors,code))return NextResponse.json({error:errors[code],code},{status:409});
  console.error('P2P warehouse transaction refused',safeErrorMetadata(e));
  return NextResponse.json({error:'Opération de stock impossible'},{status:409});
 }
}
