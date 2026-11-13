import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildBuyerWorklist,workbenchQty} from '../src/lib/buyer-workbench.ts'
const file=(p)=>readFileSync(new URL(p,import.meta.url),'utf8')
const item=(id,opts={})=>({id,ref:`MP-${id}`,name:`Article ${id}`,category:'Mousse',unit:'bloc',stockQty:0,minStock:4,isPurchasable:true,isManufactured:false,foamNature:'PURE',activeSupplierCount:1,...opts})
test('source fixture: ruptures achetables, faibles et fabrication sont séparées',()=>{
 const rows=[...Array.from({length:12},(_,i)=>item(i+1)),...Array.from({length:21},(_,i)=>item(i+13,{stockQty:2})),...Array.from({length:7},(_,i)=>item(i+34,{isPurchasable:false,isManufactured:true,foamNature:'AGGLO'}))]
 const {counts,tasks}=buildBuyerWorklist(rows,[],[])
 assert.equal(counts.toBuyOut,12);assert.equal(counts.toBuyLow,21);assert.equal(counts.manufacturing,7)
 assert.equal(counts.totalAlerts,40);assert.equal(tasks.length,40)
 assert.equal(tasks.filter(t=>t.stage==='create_da').length,33)
 assert.equal(tasks.filter(t=>t.stage==='manufacturing').length,7)
})
test('DOUBLONS: une DA ouverte retire la matière du bouton création DA',()=>{
 const rows=[item(1),item(2),item(3),item(4)]
 const req=[{materialId:1,status:'pending',requestRef:'DA-001',requestedAt:'2026-11-05'},{materialId:2,status:'approved',requestRef:'DA-002',requestedAt:'2026-11-05'},{materialId:3,status:'ordered',requestRef:'DA-003',requestedAt:'2026-11-05'}]
 const {counts,tasks}=buildBuyerWorklist(rows,req,[{materialId:3,qty:4,receivedQty:1}])
 assert.equal(counts.toBuyOut,1);assert.equal(counts.awaitApproval,1);assert.equal(counts.awaitSourcing,1);assert.equal(counts.awaitReceipt,1)
 assert.equal(tasks.find(t=>t.materialId===3)?.inboundQty,3)
 assert.deepEqual(tasks.find(t=>t.materialId===1)?.requestRefs,['DA-001'])
})
test('Les besoins sans fournisseur ne sont pas automatiquement achetés',()=>{
 const {counts,tasks}=buildBuyerWorklist([item(1,{activeSupplierCount:0}),item(2,{isPurchasable:false,isManufactured:false})],[],[])
 assert.equal(counts.needSupplier,1);assert.equal(counts.blocked,1);assert.ok(tasks.every(t=>t.stage!=='create_da'))
})
test('Unité bloc indivisible, kg 3 décimales max; suggestions non arrondies à la baisse',()=>{
 assert.equal(workbenchQty(0.5,'bloc'),1)
 assert.equal(workbenchQty(1.125,'kg'),1.125)
 assert.equal(workbenchQty(1.12345,'kg'),1.124)
 assert.equal(workbenchQty(0,'bloc'),0)
})
test('RBAC côté API et aucun prix transmis au poste de travail',()=>{
 const api=file('../src/app/api/p2p/buyer-workbench/route.ts')
 assert.ok(api.includes("readRoleGate(req,['buyer'])"))
 assert.ok(api.includes("'Cache-Control':'private, no-store'"))
 assert.ok(!api.includes('unitPrice:'))
 assert.ok(!api.includes('averageCost:'))
 assert.ok(!api.includes('supplier.email'))
})
test('Navigation, écrans et blocage création pour mousse agglomérée',()=>{
 const app=file('../src/components/erp/erp-app.tsx')
 const nav=file('../src/components/erp/nav-sidebar.tsx')
 const view=file('../src/components/erp/buyer-workbench-view.tsx')
 assert.ok(app.includes('BuyerWorkbenchView'))
 assert.ok(app.includes('explicitInitialView'))
 assert.ok(nav.includes('Mes actions achats'))
 assert.ok(view.includes("item.stage==='create_da'"))
 assert.ok(view.includes("selected.foamNature==='AGGLO'"))
 assert.ok(view.includes("onOpenPurchase(selected)"))
 assert.ok(!view.includes('method:"POST"'))
})
