/** Server-side purchase DTO: keep pricing and stock valuation out of every nested object
 * when the caller does not hold costs.read. Never rely on hiding table columns. */
export function presentPurchase<
 T extends { lines: Array<{ qty:number; unitPrice:number|null; material:{unitPrice:number;averageCost:unknown} }> }
>(purchase:T, canReadCosts:boolean) {
 const total=canReadCosts?purchase.lines.reduce((t,l)=>t+l.qty*(l.unitPrice??l.material.unitPrice),0):null
 return {
  ...purchase,
  lines:purchase.lines.map(line=>({
   ...line,
   unitPrice:canReadCosts?line.unitPrice:null,
   material:{...line.material,unitPrice:canReadCosts?line.material.unitPrice:null,averageCost:canReadCosts?line.material.averageCost:null},
  })),
  total,
 }
}
