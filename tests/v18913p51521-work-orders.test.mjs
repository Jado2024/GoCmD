import assert from 'node:assert/strict'
import {paginateWorkOrderPieces,hasTechnicalDrawing,canGenerateOF,OF_LABELS_PER_PAGE,WORK_ORDER_NEXT} from '../src/lib/work-order-labels.ts'

function pieces(n){return Array.from({length:n},(_,i)=>({code:`CMD-2026-0301-001-S01-L${String(i+1).padStart(2,'0')}-P01`,partRef:`L${String(i+1).padStart(2,'0')}`}))}
for(const [name,amount,expected] of [['salon mixte',9,[8,1]],['matelas 7',7,[7]],['matelas 11',11,[8,3]],['matelas 8',8,[8]],['matelas 16',16,[8,8]]]){
 const pages=paginateWorkOrderPieces(pieces(amount))
 assert.deepEqual(pages.map(x=>x.length),expected)
 assert.deepEqual(pages.flat().map(x=>x.code),pieces(amount).map(x=>x.code))
 console.log(`PASS ${name}: ${amount} pièces, ${pages.length} pages A4 [${expected.join('+')}]`)
}
assert.equal(OF_LABELS_PER_PAGE,8)
assert.deepEqual(paginateWorkOrderPieces([]),[])
assert.throws(()=>paginateWorkOrderPieces([{code:'X'},{code:'X'}]),/dupliquées/)
assert.throws(()=>paginateWorkOrderPieces(pieces(1001)),/maximal/)
assert.equal(hasTechnicalDrawing('SALON','21'),true)
assert.equal(hasTechnicalDrawing('SALON','51'),true)
assert.equal(hasTechnicalDrawing('SALON','STD'),false)
assert.equal(hasTechnicalDrawing('SALON',null),false)
assert.equal(hasTechnicalDrawing('MATELAS','51'),false)
assert.equal(hasTechnicalDrawing('MATELAS',null),false)
assert.equal(canGenerateOF('new','open',9,false),true)
assert.equal(canGenerateOF('production','open',11,false),true)
assert.equal(canGenerateOF('pending_validation','open',9,false),false)
assert.equal(canGenerateOF('new','on_hold',9,false),false)
assert.equal(canGenerateOF('ready','open',9,false),true)
assert.equal(canGenerateOF('new','open',9,true),true)
assert.equal(canGenerateOF('ready','open',0,true),true)
assert.equal(canGenerateOF('new','open',0,false),false)
assert.deepEqual(Object.values(WORK_ORDER_NEXT),['approved','in_progress','completed',null,null])
console.log('PASS règles dessin matelas, gabarits, éligibilité, statuts et doublons (19+ assertions)')
