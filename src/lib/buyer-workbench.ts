/** P5.15.5 : une lecture de tâches pour l'acheteur, sans mutation ni nouveau MRP.
 * Les états sont des propositions de navigation, jamais des validations de DA/BC.
 */
import { permitsFraction } from './purchase-quantity.ts'
import { calculateReplenishment } from './replenishment-policy.ts'

export type BuyerStage = 'create_da' | 'supplier_missing' | 'awaiting_approval' | 'awaiting_sourcing' | 'awaiting_receipt' | 'manufacturing' | 'not_purchasable'
export type BuyerStockMaterial = {
  id:number; ref:string; name:string; category:string; unit:string
  stockQty:number; minStock:number; targetStock?:number|null; reservedQty?:number; unreservedSalesQty?:number; isPurchasable:boolean; isManufactured:boolean
  foamNature:string|null; activeSupplierCount:number
}
export type BuyerOpenRequestLine = { materialId:number; requestRef:string; status:string; requestedAt:string }
export type BuyerInbound = {materialId:number;qty:number;receivedQty:number}
export type BuyerTask = {
  materialId:number;ref:string;name:string;category:string;unit:string
  stockQty:number;minStock:number;targetStock:number;projectedQty:number;shortage:number;suggestedQty:number
  severity:'rupture'|'stock_faible';stage:BuyerStage;reason:string
  activeSupplierCount:number;inboundQty:number;requestRefs:string[]
}
export type BuyerCounts = {
  toBuyOut:number;toBuyLow:number;needSupplier:number;awaitApproval:number
  awaitSourcing:number;awaitReceipt:number;manufacturing:number;blocked:number;totalAlerts:number
}

export function workbenchQty(shortage:number,unit:string):number {
  if(!Number.isFinite(shortage)||shortage<=0)return 0
  // Pas d'arrondi implicite du stock ; seule la PROPOSITION de commande monte
  // au multiple supérieur de l'unité légale. L'acheteur valide la quantité.
  return permitsFraction(unit)?Math.ceil((shortage-1e-9)*1000)/1000:Math.ceil(shortage-1e-9)
}
export function buildBuyerWorklist(
  materials:readonly BuyerStockMaterial[],
  openLines:readonly BuyerOpenRequestLine[],
  inboundLines:readonly BuyerInbound[],
):{tasks:BuyerTask[];counts:BuyerCounts}{
  const openByMaterial=new Map<number,BuyerOpenRequestLine[]>()
  for(const line of openLines){const list=openByMaterial.get(line.materialId)??[];list.push(line);openByMaterial.set(line.materialId,list)}
  const inboundByMaterial=new Map<number,number>()
  for(const line of inboundLines){
    if(!Number.isFinite(line.qty)||!Number.isFinite(line.receivedQty))continue
    inboundByMaterial.set(line.materialId,(inboundByMaterial.get(line.materialId)??0)+Math.max(0,line.qty-line.receivedQty))
  }
  const tasks:BuyerTask[]=[]
  const counts:BuyerCounts={toBuyOut:0,toBuyLow:0,needSupplier:0,awaitApproval:0,awaitSourcing:0,awaitReceipt:0,manufacturing:0,blocked:0,totalAlerts:0}
  for(const m of materials){
    if(!Number.isFinite(m.stockQty)||!Number.isFinite(m.minStock)||m.minStock<=0)continue
    const related=openByMaterial.get(m.id)??[]
    const inboundQty=inboundByMaterial.get(m.id)??0
    let computed:ReturnType<typeof calculateReplenishment>
    try{
      computed=calculateReplenishment({physical:m.stockQty,reserved:m.reservedQty??0,
        unreservedDemand:m.unreservedSalesQty??0,firmInbound:inboundQty,minStock:m.minStock,
        targetStock:m.targetStock??null,unit:m.unit})
    }catch{continue} // Stock impossible : ne jamais conseiller une quantite inventee
    if(!computed.triggered)continue
    const shortage=computed.shortage
    const severity=computed.freeQty<=0?'rupture':'stock_faible'
    const internal = m.category==='Mousse'&&m.foamNature==='AGGLO' || (!m.isPurchasable&&m.isManufactured)
    let stage:BuyerStage,reason:string
    if(internal){stage='manufacturing';reason='Fabrication interne : aucune DA fournisseur à créer'}
    else if(!m.isPurchasable){stage='not_purchasable';reason='Article non achetable : vérifier sa classification'}
    else if(related.some(x=>x.status==='pending')){stage='awaiting_approval';reason='Une demande existe : attendre la décision, ne pas la doubler'}
    else if(inboundQty>0 || related.some(x=>['ordered','partial'].includes(x.status))){stage='awaiting_receipt';reason='Approvisionnement engagé : vérifier le reliquat et la réception'}
    else if(related.some(x=>['approved','partially_approved'].includes(x.status))){stage='awaiting_sourcing';reason='Demande validée : préparer consultation ou BC'}
    else if(m.activeSupplierCount===0){stage='supplier_missing';reason='Aucun fournisseur actif référencé : compléter le sourcing'}
    else {stage='create_da';reason='Besoin à analyser puis soumettre pour approbation'}
    tasks.push({materialId:m.id,ref:m.ref,name:m.name,category:m.category,unit:m.unit,stockQty:m.stockQty,minStock:m.minStock,targetStock:computed.targetStock,projectedQty:computed.projectedQty,
      shortage,suggestedQty:computed.suggestedQty,severity,stage,reason,activeSupplierCount:m.activeSupplierCount,
      inboundQty,requestRefs:[...new Set(related.map(x=>x.requestRef))]})
    counts.totalAlerts++
    switch(stage){
      case 'create_da':if(severity==='rupture')counts.toBuyOut++;else counts.toBuyLow++;break
      case 'supplier_missing':counts.needSupplier++;break
      case 'awaiting_approval':counts.awaitApproval++;break
      case 'awaiting_sourcing':counts.awaitSourcing++;break
      case 'awaiting_receipt':counts.awaitReceipt++;break
      case 'manufacturing':counts.manufacturing++;break
      default:counts.blocked++
    }
  }
  const rank:Record<BuyerStage,number>={create_da:0,supplier_missing:1,awaiting_approval:2,awaiting_sourcing:3,awaiting_receipt:4,manufacturing:5,not_purchasable:6}
  tasks.sort((a,b)=>rank[a.stage]-rank[b.stage]|| (a.severity==='rupture'?-1:1)-(b.severity==='rupture'?-1:1)||b.shortage-a.shortage||a.ref.localeCompare(b.ref))
  return {tasks,counts}
}
