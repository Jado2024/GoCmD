import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { summarizeMaterialDa, daOpenQty, daAvailableCoverage } from '../src/lib/material-da-summary.ts'

const row=(ref,status,qty,orders=[],materialId=1,receivedQty=0)=>({id:Number(ref.replace(/\D/g,'')),ref,status,createdAt:'2026-11-05T12:00:00Z',expectedDate:null,
  lines:[{id:Number(ref.replace(/\D/g,'')),materialId,qty,receivedQty,supplierOrderLines:orders}]})
const order=(ref,status,qty,receivedQty)=>({qty,receivedQty,order:{ref,status}})
const data=[
 row('DA-001','pending',25),
 row('DA-002','approved',80),
 row('DA-003','ordered',100,[order('BC-1','draft',20,0),order('BC-2','confirmed',70,30)],1,30),
 row('DA-004','partial',100,[order('BC-3','partial',80,50),order('BC-4','closed',20,0)],1,50),
 row('DA-005','received',20,[order('BC-5','received',20,20)],1,20),
 row('DA-006','cancelled',100),
 row('DA-007','closed',80,[order('BC-6','closed',80,30)],1,30),
 row('DA-008','pending',12,[],2),
]
const summaries=summarizeMaterialDa(data)
assert.equal(summaries[1].pendingQty,25)
assert.equal(summaries[1].approvedQty,130) // 80 sans BC + 30 de DA-003 + 20 libérés du BC clos de DA-004
assert.equal(summaries[1].draftQty,20)
assert.equal(summaries[1].orderedRemainingQty,70) // 40 + 30
assert.equal(daOpenQty(summaries[1]),225) // brouillons EXCLUS des engagements
assert.equal(daAvailableCoverage(summaries[1]),200)
assert.equal(summaries[2].pendingQty,12)
assert.equal(summaries[2].history.length,1)
assert.equal(summaries[1].history.length,7)
assert.equal(summaries[1].history.find(x=>x.ref==='DA-006').approvedToOrderQty,0)
assert.equal(summaries[1].history.find(x=>x.ref==='DA-007').orderedRemainingQty,0)
assert.equal(daOpenQty(undefined),0)
assert.equal(daAvailableCoverage(undefined),0)
assert.ok(summaries[1].acceptedQty>=100)
const route=readFileSync(new URL('../src/app/api/materials/da-followup/route.ts',import.meta.url),'utf8')
assert.match(route,/readRoleGate/)
assert.match(route,/select:\s*\{/)
assert.doesNotMatch(route,/unitPrice|averageCost|supplierPrice|contractRef/)
const ui=readFileSync(new URL('../src/components/erp/materials-view.tsx',import.meta.url),'utf8')
assert.match(ui,/DA à valider/)
assert.match(ui,/Validées sans BC/)
assert.match(ui,/BC brouillons/)
assert.match(ui,/Reste à recevoir/)
assert.match(ui,/Historique des DA/)
assert.match(ui,/ackAdditionalDa/)
console.log('PASS P5.14.4 : quantités par statut, pas de double comptage, historique, contrôles d’accès et prévention des doublons')
