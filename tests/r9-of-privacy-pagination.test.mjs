import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { workOrderDtoForViewer } from '../src/lib/work-order-dto.ts'

const snapshot={
 orderRef:'CMD-2026-001',orderDate:'2026-11-12',
 client:{name:'Client Confidentiel Nominatif',city:'Ville Privée'},
 contractualConfiguration:{kind:'GENERIC',unitPrice:235,quantity:8,unit:'ml',requiresPreparation:true},
 product:{name:'Banquette spéciale',technicalInstructions:'Mousse D35, 180 cm',family:'SALON'},
 pieces:[],quantity:8,unit:'ml',stockTrade:false,
}
const row={id:7,ref:'OF-0007',status:'approved',snapshotJson:JSON.stringify(snapshot)}

test('inventory-only response never exposes customer name, city, contract price or raw snapshot',()=>{
 const dto=workOrderDtoForViewer(row,false)
 const text=JSON.stringify(dto)
 assert.equal(Object.hasOwn(dto,'snapshotJson'),false)
 assert.equal(dto.snapshot.client.name,'Client confidentiel')
 assert.equal(dto.snapshot.client.city,'')
 assert.equal(Object.hasOwn(dto.snapshot,'contractualConfiguration'),false)
 assert.doesNotMatch(text,/Client Confidentiel Nominatif|Ville Privée|unitPrice|235/)
 assert.equal(dto.snapshot.product.technicalInstructions,'Mousse D35, 180 cm')
})
test('commercially authorized response preserves the full immutable snapshot but not raw duplicate',()=>{
 const dto=workOrderDtoForViewer(row,true)
 assert.deepEqual(dto.snapshot, snapshot)
 assert.equal(Object.hasOwn(dto,'snapshotJson'),false)
 assert.equal(JSON.parse(row.snapshotJson).client.name,'Client Confidentiel Nominatif')
})
test('redaction is not sticky: a later authorized request still sees the original',()=>{
 workOrderDtoForViewer(row,false)
 const dto=workOrderDtoForViewer(row,true)
 assert.equal(dto.snapshot.contractualConfiguration.unitPrice,235)
})
test('invalid snapshots fail closed',()=>{
 assert.throws(()=>workOrderDtoForViewer({...row,snapshotJson:'null'},false),/OF_SNAPSHOT_INVALID/)
 assert.throws(()=>workOrderDtoForViewer({...row,snapshotJson:'[]'},false),/OF_SNAPSHOT_INVALID/)
})
test('work order GET/POST and PATCH all use the same secure serialization',()=>{
 const list=fs.readFileSync('src/app/api/work-orders/route.ts','utf8')
 const patch=fs.readFileSync('src/app/api/work-orders/[id]/route.ts','utf8')
 assert.match(list,/workOrderDtoForViewer\(\{/)
 assert.match(list,/workOrderDtoForViewer\(workOrder,hasPermission\(req,"clients\.read"\)\)/)
 assert.match(patch,/workOrderDtoForViewer\(result,hasPermission\(req,"clients\.read"\)\)/)
 assert.doesNotMatch(patch,/workOrder:\{\.\.\.result,snapshot:/)
})
test('work order GET has checked paging and inventory UI offers next/previous',()=>{
 const api=fs.readFileSync('src/app/api/work-orders/route.ts','utf8')
 const ui=fs.readFileSync('src/components/erp/inventory-work-orders.tsx','utf8')
 assert.match(api,/Number\.isSafeInteger\(take\)/)
 assert.match(api,/Number\.isSafeInteger\(skip\)/)
 assert.match(api,/db\.workOrder\.count\(\{where\}\)/)
 assert.match(api,/orderBy:\{id:"desc"\},skip,take/)
 assert.match(api,/hasMore:skip\+rows\.length<total/)
 assert.match(ui,/inventory-work-orders",page/)
 assert.match(ui,/page\*50/)
 assert.match(ui,/>Précédent</)
 assert.match(ui,/>Suivant</)
})
