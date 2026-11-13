/** Réservation sur stock physique disponible : aucune réservation ne débite un lot.
 * Les mouvements destructifs vérifient la quantité NON réservée dans la même transaction.
 * La sérialisation SQLite ne remplace pas des tests multi-processus sur la cible.
 */
import type {Prisma} from "@prisma/client"
export const EPS=1e-7
export function stockFree(physical:number,reserved:number):number {
  return Math.max(0,Math.round((physical-reserved)*1000)/1000)
}
export async function reservedLotQty(tx:Prisma.TransactionClient,lotId:number):Promise<number> {
  const r=await tx.salesStockReservation.aggregate({where:{stockLotId:lotId},_sum:{qty:true}})
  return r._sum.qty??0
}
export async function assertStockUnreserved(tx:Prisma.TransactionClient,lotId:number,physical:number,remove:number):Promise<void> {
  if(remove>physical-(await reservedLotQty(tx,lotId))+EPS)throw new Error("STOCK_RESERVED")
}
