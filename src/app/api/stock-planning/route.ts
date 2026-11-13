/** Reconstitution du stock : simulation sans creation automatique de DA/OF.
 * Les unites, demandes clients, reservations et commandes fournisseurs ouvertes
 * sont prises en compte avant de proposer une nouvelle fabrication ou DA.
 */
import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {db} from '@/lib/db'
import {accessGate,currentActor,hasAnyReadRole,hasRole,hasPermission} from '@/lib/access-gate'
import {calculateReplenishment} from '@/lib/replenishment-policy'
import {calculateOpenMaterialDemand} from '@/lib/material-open-demand'
import {requiresInternalManufacturing,isValidStockQuantity} from '@/lib/stock-quantity'
import {serializedSQLiteWrite} from '@/lib/sqlite-write'
export const dynamic='force-dynamic'
const visible=['buyer','approver','inventory','receiver','quality','director','production','finance'] as const
function canPlan(req:NextRequest){return (hasRole(req,'buyer')||hasRole(req,'inventory')||hasRole(req,'production')) && (!currentActor(req)?.managed||(hasRole(req,'buyer')&&hasPermission(req,'purchases.create'))||(hasRole(req,'inventory')&&hasPermission(req,'stock.move'))||(hasRole(req,'production')&&hasPermission(req,'production.propose')))}
function canApprove(req:NextRequest){return hasRole(req,'production')&&(!currentActor(req)?.managed||hasPermission(req,'production.approve'))}
function canClose(req:NextRequest){return hasRole(req,'production')&&(!currentActor(req)?.managed||hasPermission(req,'production.close'))}
const newPlan=z.object({action:z.literal('propose'),kind:z.enum(['product','material']),id:z.number().int().positive(),reason:z.string().trim().min(10).max(500)}).strict()
const decide=z.object({action:z.enum(['approve','reject','cancel','complete']),requestId:z.number().int().positive(),reason:z.string().trim().min(10).max(500)}).strict()
function fail(msg:string,status=409){return NextResponse.json({error:msg},{status,headers:{'Cache-Control':'no-store'}})}
async function positions(tx:typeof db){
  const [materials,products,poLines,materialBookings,productLots,productBookings,orders,materialOrders,existing]=await Promise.all([
    tx.material.findMany({where:{minStock:{gt:0}},select:{id:true,ref:true,name:true,unit:true,stockQty:true,minStock:true,targetStock:true,isPurchasable:true,isManufactured:true,category:true,foamNature:true}}),
    tx.product.findMany({where:{minStock:{gt:0},materialId:null,status:'active'},select:{id:true,sku:true,name:true,family:true,unit:true,minStock:true,targetStock:true}}),
    tx.supplierOrderLine.findMany({where:{order:{status:{in:['confirmed','partial']}}},select:{materialId:true,qty:true,receivedQty:true}}),
    tx.salesStockReservation.findMany({select:{orderLineId:true,qty:true,stockLot:{select:{materialId:true}}}}),
    tx.finishedStockLot.findMany({where:{qty:{gt:0},status:'available'},select:{id:true,productId:true,qty:true,expiresAt:true}}),
    tx.finishedStockReservation.findMany({select:{orderLineId:true,lotId:true,qty:true}}),
    tx.orderLine.findMany({where:{order:{fulfillmentStatus:'open',status:{in:['new','production','ready']}},product:{materialId:null}},select:{id:true,productId:true,qty:true,unit:true}}),
    tx.orderLine.findMany({where:{order:{fulfillmentStatus:'open',status:{in:['new','production','ready']}},product:{materialId:{not:null}}},select:{id:true,qty:true,stockUnitsPerSale:true,product:{select:{materialId:true}}}}),
    tx.productionReplenishmentRequest.findMany({where:{status:{in:['proposed','approved']}},select:{id:true,ref:true,productId:true,materialId:true,status:true,qty:true}}),
  ])
  const allOrderIds=[...orders.map(x=>x.id),...materialOrders.map(x=>x.id)]
  const deliveryLines=allOrderIds.length?await tx.salesDeliveryLine.findMany({where:{orderLineId:{in:allOrderIds}},select:{orderLineId:true,qty:true}}):[]
  const inbound=new Map<number,number>(),matReserved=new Map<number,number>(),lotReserved=new Map<number,number>(),lineReserved=new Map<number,number>(),delivered=new Map<number,number>()
  for(const l of poLines)inbound.set(l.materialId,(inbound.get(l.materialId)??0)+Math.max(0,l.qty-l.receivedQty))
  for(const b of materialBookings)matReserved.set(b.stockLot.materialId,(matReserved.get(b.stockLot.materialId)??0)+b.qty)
  for(const b of productBookings){lotReserved.set(b.lotId,(lotReserved.get(b.lotId)??0)+b.qty);lineReserved.set(b.orderLineId,(lineReserved.get(b.orderLineId)??0)+b.qty)}
  for(const l of deliveryLines)delivered.set(l.orderLineId,(delivered.get(l.orderLineId)??0)+l.qty)
  const demand=new Map<number,number>()
  for(const l of orders){
    const outstanding=Math.max(0,l.qty-(delivered.get(l.id)??0)-(lineReserved.get(l.id)??0))
    demand.set(l.productId,(demand.get(l.productId)??0)+outstanding)
  }
  const lotsByProduct=new Map<number,{physical:number,reserved:number}>()
  const today=Date.now()
  for(const l of productLots){
    if(l.expiresAt && l.expiresAt.getTime()<=today)continue
    const current=lotsByProduct.get(l.productId)??{physical:0,reserved:0}
    current.physical+=l.qty;current.reserved+=lotReserved.get(l.id)??0
    lotsByProduct.set(l.productId,current)
  }
  const openMaterialDemand=calculateOpenMaterialDemand(materialOrders.filter(x=>x.product.materialId!=null)
    .map(x=>({id:x.id,materialId:x.product.materialId!,qty:x.qty,unitsPerSale:x.stockUnitsPerSale})),
    deliveryLines,materialBookings)
  const openByMaterial=new Map(existing.filter(r=>r.materialId!==null).map(r=>[r.materialId,r]))
  const openByProduct=new Map(existing.filter(r=>r.productId!==null).map(r=>[r.productId,r]))
  const items:Array<Record<string,unknown>>=[]
  for(const m of materials){
    const kind=(!m.isPurchasable||m.isManufactured||requiresInternalManufacturing(m))?'FABRICATION':'ACHAT'
    const open=openByMaterial.get(m.id)
    try{
      const result=calculateReplenishment({physical:m.stockQty,reserved:matReserved.get(m.id)??0,unreservedDemand:openMaterialDemand.get(m.id)??0,firmInbound:kind==='ACHAT'?(inbound.get(m.id)??0):0,minStock:m.minStock,targetStock:m.targetStock,unit:m.unit})
      items.push({kind:'material',id:m.id,ref:m.ref,name:m.name,unit:m.unit,procurementType:kind,stockTracking:'active',...result,openRequest:open?.ref??null,requestStatus:open?.status??null})
    }catch{items.push({kind:'material',id:m.id,ref:m.ref,name:m.name,stockTracking:'invalid',reason:'Seuil, quantite ou reservation incoherente : audit de stock necessaire'})}
  }
  for(const p of products){
    const open=openByProduct.get(p.id)
    // Ne jamais supposer que le stock d'un produit non suivi est ZERO.
    // Les produits finis à l’unité ont des lots/BL. Les ventes en ml et kg
    // exigent un suivi spécifique des variantes et conversions physiques.
    if(p.unit!=='u'){
      items.push({kind:'product',id:p.id,ref:p.sku,name:p.name,unit:p.unit,procurementType:'FABRICATION',stockTracking:'not_connected',minStock:p.minStock,targetStock:p.targetStock??p.minStock,reason:'Stock fini de cette famille non relie aux lots/BL : aucune proposition quantitative automatique'})
      continue
    }
    try{
      const l=lotsByProduct.get(p.id)??{physical:0,reserved:0}
      const result=calculateReplenishment({physical:l.physical,reserved:l.reserved,unreservedDemand:demand.get(p.id)??0,firmInbound:0,minStock:p.minStock,targetStock:p.targetStock,unit:p.unit})
      items.push({kind:'product',id:p.id,ref:p.sku,name:p.name,unit:p.unit,procurementType:'FABRICATION',stockTracking:'active',...result,openRequest:open?.ref??null,requestStatus:open?.status??null})
    }catch{items.push({kind:'product',id:p.id,ref:p.sku,name:p.name,stockTracking:'invalid',reason:'Quantites ou seuils incoherents'})}
  }
  return items
}
export async function GET(req:NextRequest){
  const denied=accessGate(req);if(denied)return denied
  if(!hasAnyReadRole(req,[...visible]))return fail('Acces planification refuse',403)
  const all=await positions(db)
  const take=Math.min(200,Math.max(1,Number(req.nextUrl.searchParams.get('take'))||100))
  const requestBefore=Number(req.nextUrl.searchParams.get('requestBefore'))
  const requests=await db.productionReplenishmentRequest.findMany({where:{status:{in:['proposed','approved']},...(Number.isSafeInteger(requestBefore)&&requestBefore>0?{id:{lt:requestBefore}}:{})},include:{stockOrder:true},orderBy:{id:'desc'},take})
  const filtered=all.filter(item=>{
    const kind=req.nextUrl.searchParams.get('kind')
    const query=(req.nextUrl.searchParams.get('search')||'').trim().toLowerCase()
    return (!kind||kind==='all'||item.kind===kind)&&(!query||`${item.ref||''} ${item.name||''}`.toLowerCase().includes(query))
  })
  const offset=Math.min(Math.max(0,Number(req.nextUrl.searchParams.get('offset'))||0),1000000)
  const items=filtered.slice(offset,offset+take)
  return NextResponse.json({items,totalItems:filtered.length,nextOffset:offset+take<filtered.length?offset+take:null,nextRequestBefore:requests.length===take?requests.at(-1)?.id:null,requests,note:'Alertes de planification uniquement : aucune DA ni OF declenche sans decision nominative. Les familles sans suivi physique sont signalees.'},{headers:{'Cache-Control':'private, no-store'}})
}
export async function POST(req:NextRequest){
  const denied=accessGate(req);if(denied)return denied
  const raw=await req.json().catch(()=>null)
  const proposed=newPlan.safeParse(raw),decided=decide.safeParse(raw)
  if(!proposed.success&&!decided.success)return fail('Demande invalide',400)
  if(proposed.success&&!canPlan(req))return fail('Proposition reservee aux achats et magasin',403)
  if(decided.success && decided.data.action==='complete' && !canClose(req))return fail('Cloture reservee a la production habilitee',403)
  if(decided.success && decided.data.action!=='complete' && !canApprove(req) && !(decided.data.action==='cancel' && canPlan(req)))return fail('Decision reservee au responsable production',403)
  const actor=currentActor(req)!.username
  try{
    const data=await serializedSQLiteWrite(()=>db.$transaction(async tx=>{
      await tx.salesDocCounter.upsert({where:{id:'GOCMD_REPLENISH_LOCK'},create:{id:'GOCMD_REPLENISH_LOCK',value:1},update:{value:{increment:1}}})
      if(proposed.success){
        const d=proposed.data
        const results=await positions(tx as typeof db)
        const item=results.find(x=>x.kind===d.kind&&x.id===d.id)
        if(!item||item.stockTracking!=='active'||item.procurementType!=='FABRICATION'||item.triggered!==true)throw Error('NOT_ELIGIBLE')
        if(item.openRequest)throw Error('REQUEST_ALREADY_OPEN')
        const qty=Number(item.suggestedQty),unit=String(item.unit)
        if(!isValidStockQuantity(qty,unit))throw Error('INVALID_QUANTITY')
        const num=await tx.salesDocCounter.upsert({where:{id:'PROD_REPLENISH_SEQUENCE'},create:{id:'PROD_REPLENISH_SEQUENCE',value:1},update:{value:{increment:1}}})
        const ref=`DPR-${new Date().getUTCFullYear()}-${String(num.value).padStart(6,'0')}`
        const row=await tx.productionReplenishmentRequest.create({data:{ref,qty,unit,reason:d.reason,createdBy:actor,...(d.kind==='product'?{productId:d.id}:{materialId:d.id})}})
        await tx.auditEvent.create({data:{actor,action:'PRODUCTION_REPLENISHMENT_PROPOSED',entity:'ProductionReplenishmentRequest',entityId:String(row.id),details:JSON.stringify({ref,qty,unit})}})
        return row
      }
      if(!decided.success)throw Error('INVALID')
      const d=decided.data
      const row=await tx.productionReplenishmentRequest.findUnique({where:{id:d.requestId}})
      if(!row||!(row.status==='proposed'||row.status==='approved'&&['cancel','complete'].includes(d.action)))throw Error('REQUEST_NOT_PENDING')
      if(d.action==='approve'&&row.createdBy===actor)throw Error('SELF_APPROVAL')
      if(d.action==='cancel'&&row.status==='proposed'&&row.createdBy!==actor&&!canApprove(req))throw Error('CANCEL_NOT_OWNER')
      if(row.status==='approved'&&d.action==='cancel'&&!canApprove(req))throw Error('APPROVER_REQUIRED')
      const order=await tx.productionStockOrder.findUnique({where:{requestId:row.id}})
      if(row.status==='approved'&&!order)throw Error('STOCK_ORDER_MISSING')
      if(d.action==='cancel'&&order){
        if(!['approved','planned'].includes(order.status))throw Error('ALREADY_STARTED')
        const received=row.productId ? await tx.finishedStockMovement.count({where:{type:'received_quarantine',lot:{sourceRef:row.ref}}}) : await tx.productionMaterialReceipt.count({where:{stockOrderId:order.id}})
        if(received)throw Error('RECEIPT_ALREADY_EXISTS')
      }
      // Nouvelle proposition si la position a change, ne pas approuver une ancienne quantite.
      if(d.action==='approve'){
        const fresh=(await positions(tx as typeof db)).find(x=>row.productId?x.kind==='product'&&x.id===row.productId:x.kind==='material'&&x.id===row.materialId)
        if(!fresh||fresh.stockTracking!=='active'||fresh.triggered!==true||Math.abs(Number(fresh.suggestedQty)-row.qty)>1e-6)throw Error('STALE_REQUEST')
      }
      if(d.action==='complete'){
        // Une demande validee ne peut etre cloturee sur simple declaration :
        // preuve d'entree en stock sous sa reference obligatoire.
        if(order?.status!=='completed')throw Error('STOCK_ORDER_NOT_COMPLETED')
        if(row.productId){
          // Historiques de réception, jamais la quantité résiduelle d'un lot vendu.
          const sum=await tx.finishedStockMovement.aggregate({where:{type:'received_quarantine',lot:{productId:row.productId,sourceRef:row.ref,status:{in:['available','exhausted']}}},_sum:{qty:true}})
          if((sum._sum.qty??0)+1e-6<row.qty)throw Error('RECEIPT_NOT_PROVEN')
        }else if(row.materialId){
          const sums=await tx.productionMaterialReceipt.aggregate({where:{stockOrderId:order.id,status:'released'},_sum:{qty:true}})
          if((sums._sum.qty??0)+1e-6<row.qty)throw Error('RECEIPT_NOT_PROVEN')
        }else throw Error('RECEIPT_NOT_PROVEN')
      }
      const status=d.action==='approve'?'approved':d.action==='reject'?'rejected':d.action==='complete'?'completed':'cancelled'
      const changed=await tx.productionReplenishmentRequest.updateMany({where:{id:row.id,status:row.status},data:{status,decidedBy:actor,decidedAt:new Date(),decisionReason:d.reason}})
      if(changed.count!==1)throw Error('CONFLICT')
      if(d.action==='approve'){
        const next=await tx.salesDocCounter.upsert({where:{id:'GOCMD_MTS_OF_SEQUENCE'},create:{id:'GOCMD_MTS_OF_SEQUENCE',value:1},update:{value:{increment:1}}})
        const ref=`OFMTS-${new Date().getUTCFullYear()}-${String(next.value).padStart(6,'0')}`
        await tx.productionStockOrder.create({data:{ref,requestId:row.id,status:'approved',createdBy:actor}})
      }
      if(d.action==='cancel'&&order)await tx.productionStockOrder.update({where:{id:order.id},data:{status:'cancelled',statusReason:d.reason}})
      if(d.action==='complete'&&order)await tx.productionStockOrder.update({where:{id:order.id},data:{status:'closed',closedBy:actor,closedAt:new Date(),statusReason:d.reason}})
      await tx.auditEvent.create({data:{actor,action:`PRODUCTION_REPLENISHMENT_${status.toUpperCase()}`,entity:'ProductionReplenishmentRequest',entityId:String(row.id),details:JSON.stringify({ref:row.ref,reason:d.reason})}})
      return tx.productionReplenishmentRequest.findUniqueOrThrow({where:{id:row.id},include:{stockOrder:true}})
    }))
    return NextResponse.json({request:data},{status:proposed.success?201:200,headers:{'Cache-Control':'no-store'}})
  }catch(e){
    const code=e instanceof Error?e.message:'UNKNOWN'
    const messages:Record<string,string>={NOT_ELIGIBLE:'Aucune fabrication justifiee par le stock suivi',REQUEST_ALREADY_OPEN:'Une proposition existe deja',INVALID_QUANTITY:'Quantite non compatible avec son unite',REQUEST_NOT_PENDING:'Demande deja traitee',SELF_APPROVAL:'Double validation obligatoire',STALE_REQUEST:'La situation de stock a change : reexaminer la proposition',RECEIPT_NOT_PROVEN:'Reception qualite incomplete au regard du cumul historique attendu',STOCK_ORDER_NOT_COMPLETED:'OF MTS non termine',STOCK_ORDER_MISSING:'OF MTS introuvable : verifier la migration',ALREADY_STARTED:'OF deja lance : annulation interdite',RECEIPT_ALREADY_EXISTS:'Reception deja engagee : annulation interdite',APPROVER_REQUIRED:'Annulation dune demande validee reservee au responsable',CANCEL_NOT_OWNER:'Seul le proposant ou le responsable production peut annuler cette proposition'}
    return fail(messages[code]??'Operation refusee : controle de stock ou conflit de concurrence',409)
  }
}
