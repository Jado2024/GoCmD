/** Demande client de négoce non encore couverte par les réservations.
 * Quantité en unité de STOCK, après retranchement des livraisons.
 */
export type OpenMaterialOrder = {id:number;materialId:number;qty:number;unitsPerSale:number}
export function calculateOpenMaterialDemand(orders:readonly OpenMaterialOrder[],
 deliveries:readonly {orderLineId:number;qty:number}[],reservations:readonly {orderLineId:number;qty:number}[]){
 const out=new Map<number,number>(),delivered=new Map<number,number>(),reserved=new Map<number,number>()
 for(const d of deliveries)delivered.set(d.orderLineId,(delivered.get(d.orderLineId)??0)+d.qty)
 for(const r of reservations)reserved.set(r.orderLineId,(reserved.get(r.orderLineId)??0)+r.qty)
 for(const line of orders){
  if(!Number.isFinite(line.qty)||!Number.isFinite(line.unitsPerSale)||line.qty<0||line.unitsPerSale<=0)continue
  const stillDue=Math.max(0,line.qty-(delivered.get(line.id)??0))*line.unitsPerSale
  const pending=Math.max(0,stillDue-(reserved.get(line.id)??0))
  out.set(line.materialId,(out.get(line.materialId)??0)+pending)
 }
 return out
}
