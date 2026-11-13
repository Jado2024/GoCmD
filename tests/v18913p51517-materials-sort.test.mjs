import assert from 'node:assert/strict'
import {filterAndSortMaterials,materialRiskBand} from '../src/lib/materials-workbench-sort.ts'
const materials=[
{id:1,ref:'M-OK',name:'Mousse normale',category:'Mousse',stockQty:120,minStock:60,supplierNames:['Atlas']},
{id:2,ref:'C-OUT-DA',name:'Colle avec DA',category:'Colle',stockQty:0,minStock:60,supplierNames:['ChimiPlus']},
{id:3,ref:'C-LOW',name:'Colle faible',category:'Colle',stockQty:10,minStock:70,supplierNames:['ChimiPlus']},
{id:4,ref:'T-OUT',name:'Tissu en rupture',category:'Tissu',stockQty:0,minStock:40,supplierNames:['Tissus']},
{id:5,ref:'T-OKZERO',name:'Tissu seuil zéro',category:'Tissu',stockQty:0,minStock:0,supplierNames:['Tissus']},
]
const presence={2:{historyCount:2,activeCount:1},3:{historyCount:1,activeCount:0}}
const o={sort:'urgency',stock:'all',da:'all',supplier:'all',presence}
assert.deepEqual(filterAndSortMaterials(materials,o).map(x=>x.id),[4,5,2,3,1], 'ruptures sans DA priorisées, puis rupture avec DA, puis sous seuil')
assert.deepEqual(filterAndSortMaterials(materials,{...o,da:'without-active'}).map(x=>x.id),[4,5,3,1])
assert.deepEqual(filterAndSortMaterials(materials,{...o,da:'with-active'}).map(x=>x.id),[2])
assert.deepEqual(filterAndSortMaterials(materials,{...o,da:'history'}).map(x=>x.id),[2,3])
assert.deepEqual(filterAndSortMaterials(materials,{...o,da:'without-history'}).map(x=>x.id),[4,5,1])
assert.deepEqual(filterAndSortMaterials(materials,{...o,stock:'out'}).map(x=>x.id),[4,5,2])
assert.deepEqual(filterAndSortMaterials(materials,{...o,stock:'low'}).map(x=>x.id),[3])
assert.deepEqual(filterAndSortMaterials(materials,{...o,stock:'ok'}).map(x=>x.id),[1])
assert.deepEqual(filterAndSortMaterials(materials,{...o,supplier:'ChimiPlus'}).map(x=>x.id),[2,3])
assert.deepEqual(filterAndSortMaterials(materials,{...o,sort:'name'}).map(x=>x.id),[2,3,1,4,5])
assert.deepEqual(filterAndSortMaterials(materials,{...o,da:'without-active',presence:undefined}),[], 'jamais de fausse absence de DA si API indisponible')
assert.equal(materialRiskBand(materials[4]),0,'stock 0, min 0 est une rupture')
console.log('PASS p5.15.17: 12 contrôles tri/filtres matières')
