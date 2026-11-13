import assert from 'node:assert/strict'
import { createMissingWorkOrders } from '../src/lib/work-order-create.ts'

// Simulation de la transaction Prisma : aucune mutation de stock disponible
// dans le double. Couvre allocation, atomicité logique et idempotence.
const product=(family,materialId)=>({name:family,family,materialId,coreType:null,foamComposition:null,
  mattressFinish:null,status:'active',specialNotes:null,specialPriceStatus:null})
const pieces=(count,prefix)=>Array.from({length:count},(_,i)=>({id:i+1,code:`${prefix}-${i+1}`,salonNo:1,
  elementNo:i+1,partRef:`L${i+1}`,linearMeters:1,gabaritCode:i%2?'21':'STD',billingMode:'manual',
  sequence:i+1,label:`Pièce ${i+1}`,shape:'rectangle',lengthCm:120,widthCm:60,heightCm:25,
  dimensionsExtra:null,note:null,status:'pending'}))
const makeLine=(id,qty,family,materialId,p)=>({id,qty,unit:materialId?'u':'u',product:product(family,materialId),
  pieces:p,workOrder:null,modelRef:null,configRef:null})
const order={id:301,ref:'CMD-2026-0301',createdAt:new Date('2026-11-08T10:00:00Z'),
  status:'new',fulfillmentStatus:'open',createdBy:'commercial',reviewedBy:'approver',reviewedAt:new Date('2026-11-08T10:05:00Z'),client:{name:'Test SODEPI',city:'Casablanca'},
  lines:[makeLine(1,1,'SALON',null,pieces(9,'SAL')),
    makeLine(2,7,'MATELAS',null,pieces(7,'MAT')),
    makeLine(3,1,'NEGOCE',42,[])]}
const logs=[];let counter=0
const tx={
  order:{findUnique:async()=>order},
  salesDocCounter:{upsert:async()=>({value:++counter})},
  workOrder:{create:async({data})=>{
    assert.equal(order.lines.find(l=>l.id===data.orderLineId)?.workOrder,null,'no silent duplicates')
    const created={id:counter,...data}
    order.lines.find(l=>l.id===data.orderLineId).workOrder=created
    return created
  }},
  auditEvent:{create:async({data})=>logs.push(data)},
}
assert.equal(await createMissingWorkOrders(tx,301,'approver'),3)
assert.equal(counter,3)
assert.equal(logs.length,3)
for(const [index,count] of [[0,9],[1,7],[2,0]]){
  const of=order.lines[index].workOrder
  assert.equal(of.ref,`OF-2026-${String(index+1).padStart(5,'0')}`)
  assert.equal(of.status,'approved','OF usable only after authorized CMD confirmation')
  assert.equal(of.approvedBy,'SYSTEM:CMD_CONFIRMED','no second commercial approval')
  assert.ok(of.approvedAt instanceof Date,'automatic activation must be traceable')
  assert.equal(of.totalPieces,count||1) // 1 étiquette de préparation pour le négoce, aucune pièce fictive
  assert.equal(of.createdBy,'commercial','four-eyes preserved')
  const snapshot=JSON.parse(of.snapshotJson)
  assert.equal(snapshot.pieces.length,count)
  assert.equal(snapshot.stockTrade,index===2)
  assert.equal(snapshot.quantity,order.lines[index].qty)
  assert.equal(snapshot.orderRef,order.ref)
}
assert.equal(await createMissingWorkOrders(tx,301,'other'),0,'replay idempotent')
assert.equal(counter,3,'replay does not consume reference')
order.status='pending_validation'
await assert.rejects(createMissingWorkOrders(tx,301,'approver'),/ORDER_NOT_ELIGIBLE/)
order.status='new'
order.reviewedBy=null
await assert.rejects(createMissingWorkOrders(tx,301,'approver'),/ORDER_NOT_APPROVED/)
order.reviewedBy='approver'
order.lines[1].product.status='pending_validation'
await assert.rejects(createMissingWorkOrders(tx,301,'approver'),/PRODUCT_NOT_APPROVED/)
order.lines[1].product.status='active'
console.log('PASS auto-OF : 9 salon + 7 matelas + 1 négoce, 3 OF approuvés après CMD, idempotence et refus avant validation')
