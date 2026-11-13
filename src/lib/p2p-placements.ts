import type { Prisma } from '@prisma/client';

// A stock lot's physical locations must sum to its quantity. Rows for historical
// unknown stock remain labelled NON_VERIFIE; no provenance is fabricated.
export async function defaultLocation(tx:Prisma.TransactionClient){
 const location=await tx.storageLocation.findFirst({where:{warehouse:{code:'DEFAULT'},code:'A_AFFECTER'}});
 if(!location)throw Error('MIGRATION_V08_REQUISE');return location.id;
}
export async function placeReceipt(tx:Prisma.TransactionClient,stockLotId:number,qty:number){
 const locationId=await defaultLocation(tx);
 await tx.stockPlacement.create({data:{stockLotId,locationId,qty}});
}
export async function movePlacement(tx:Prisma.TransactionClient,fromLotId:number,toLotId:number,qty:number){
 let left=qty;
 const places=await tx.stockPlacement.findMany({where:{stockLotId:fromLotId,qty:{gt:0}},orderBy:{id:'asc'}});
 for(const place of places){
  if(left<=1e-8)break;
  const amount=Math.min(left,place.qty);
  const changed=await tx.stockPlacement.updateMany({where:{id:place.id,qty:{gte:amount}},data:{qty:{decrement:amount}}});
  if(changed.count!==1)throw Error('PLACEMENT_CONCURRENT');
  await tx.stockPlacement.upsert({where:{stockLotId_locationId:{stockLotId:toLotId,locationId:place.locationId}},create:{stockLotId:toLotId,locationId:place.locationId,qty:amount},update:{qty:{increment:amount}}});
  left-=amount;
 }
 if(left>1e-6)throw Error('LOCATION_STOCK_INCONSISTENT');
}
export async function reducePlacement(tx:Prisma.TransactionClient,lotId:number,qty:number){
 let left=qty;
 const places=await tx.stockPlacement.findMany({where:{stockLotId:lotId,qty:{gt:0}},orderBy:{id:'asc'}});
 for(const place of places){
  if(left<=1e-8)break;
  const amount=Math.min(left,place.qty);
  const updated=await tx.stockPlacement.updateMany({where:{id:place.id,qty:{gte:amount}},data:{qty:{decrement:amount}}});
  if(updated.count!==1)throw Error('PLACEMENT_CONCURRENT');left-=amount;
 }
 if(left>1e-6)throw Error('LOCATION_STOCK_INCONSISTENT');
}
export async function increasePlacement(tx:Prisma.TransactionClient,lotId:number,qty:number){
 const first=await tx.stockPlacement.findFirst({where:{stockLotId:lotId},orderBy:{id:'asc'}});
 const locationId=first?.locationId??await defaultLocation(tx);
 await tx.stockPlacement.upsert({where:{stockLotId_locationId:{stockLotId:lotId,locationId}},create:{stockLotId:lotId,locationId,qty},update:{qty:{increment:qty}}});
}
