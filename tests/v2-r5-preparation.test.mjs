import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { createMissingWorkOrders, lineRequiresWorkOrder, verifyWorkOrderContract } from '../src/lib/work-order-create.ts'

const sha = o => createHash('sha256').update(JSON.stringify(o)).digest('hex')
function line(id, {kind='GENERIC', requiresPreparation=true, price=125, changed=false, pieces=[{code:'ABC'}]}={}) {
  const frozen={kind,description:'Article sur mesure',unit:'u',unitPrice:price,quantity:2,requiresPreparation}
  return {
    id,kind,technicalSnapshotJson:JSON.stringify(frozen),technicalSnapshotHash:sha(frozen),
    qty:2,unit:'u',unitPrice:changed?price+10:price,priceApprovalStatus:'approved',
    product:{name:'Hors catalogue',sku:'INT-TEST',family:'DIVERS',materialId:null,status:'active',specialNotes:null,foamLayers:null},
    pieces:pieces.map(p=>({id:1,code:p.code,sequence:1})),workOrder:null, genericTemplate:'GEN-DIV',
    productNameSnapshot:'Article sur mesure',productSkuSnapshot:'HORS CATALOGUE',modelRef:null,
    configRef:null,technicalInstructions:null,customDimensionsJson:null,
  }
}
function mockDb(lines, approved=true){
 const created=[]; const events=[]; let count=0
 const tx={
  order:{findUnique:async()=>({id:99,ref:'CMD-TEST',createdAt:new Date('2026-11-11'),createdBy:'commercial',reviewedBy:approved?'approbateur':null,reviewedAt:approved?new Date():null,status:'new',fulfillmentStatus:'open',client:{name:'Client',city:'Toulouse'},lines})},
  salesDocCounter:{upsert:async()=>({value:++count})},
  workOrder:{create:async({data})=>{created.push(data);return {id:created.length,...data}}},
  auditEvent:{create:async({data})=>{events.push(data)}},
 }
 return {tx,created,events}
}

test('generic without preparation: NO OF after independent approval',async()=>{
 const env=mockDb([line(1,{requiresPreparation:false,pieces:[]})])
 assert.equal(await createMissingWorkOrders(env.tx,99,'approbateur'),0)
 assert.equal(env.created.length,0)
})
test('mixed generic order: only preparing line gets one OF and its own snapshot',async()=>{
 const env=mockDb([line(1,{requiresPreparation:false,pieces:[]}),line(2,{requiresPreparation:true,pieces:[{code:'K02'}]})])
 assert.equal(await createMissingWorkOrders(env.tx,99,'approbateur'),1)
 assert.equal(env.created.length,1)
 assert.equal(env.created[0].orderLineId,2)
 assert.equal(JSON.parse(env.created[0].snapshotJson).contractualConfiguration.requiresPreparation,true)
 assert.equal(env.events.length,1)
})
test('no OF before review',async()=>{
 const env=mockDb([line(1)],false)
 await assert.rejects(createMissingWorkOrders(env.tx,99,'commercial'),/ORDER_NOT_APPROVED/)
 assert.equal(env.created.length,0)
})
test('price tamper or hash drift: no OF',async()=>{
 const env=mockDb([line(1,{changed:true})])
 await assert.rejects(createMissingWorkOrders(env.tx,99,'approbateur'),/CONTRACT_SNAPSHOT_PRICE_OR_UNIT_MISMATCH/)
 assert.equal(env.created.length,0)
 const drift=line(1);drift.technicalSnapshotJson=drift.technicalSnapshotJson.replace('125','126')
 const env2=mockDb([drift])
 await assert.rejects(createMissingWorkOrders(env2.tx,99,'approbateur'),/CONTRACT_SNAPSHOT_HASH_MISMATCH/)
 assert.equal(env2.created.length,0)
})
test('generic missing or invalid preparation metadata fails closed',()=>{
 assert.throws(()=>lineRequiresWorkOrder('GENERIC',null),/GENERIC_SNAPSHOT_REQUIRED/)
 assert.throws(()=>lineRequiresWorkOrder('GENERIC','{}'),/GENERIC_PREPARATION_UNKNOWN/)
 assert.throws(()=>lineRequiresWorkOrder('GENERIC','invalid'),/GENERIC_SNAPSHOT_INVALID/)
 assert.equal(lineRequiresWorkOrder('CATALOG',null),true)
 const bad=line(1);bad.technicalSnapshotHash=null
 assert.throws(()=>verifyWorkOrderContract(bad),/GENERIC_SNAPSHOT_INVALID/)
})
