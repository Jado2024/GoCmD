import assert from 'node:assert/strict'
import fs from 'node:fs'
import {isValidStockQuantity,isValidStockDelta,requiresInternalManufacturing} from '../src/lib/stock-quantity.ts'

const valid=[ [1,'bloc'],[1,'pcs'],[0,'bloc',true],[1.125,'kg'],[1.125,'ml'],[0.001,'m³'],[1000000,'bloc'] ]
const invalid=[[0.5,'bloc'],[1.5,'u'],[0.5,'rouleau'],[0.25,'plaque'],[0.5,'pcs'],[-1,'kg'],[0,'bloc'],[1.1234,'kg'],[1e7,'kg'],[Number.NaN,'kg'],[Infinity,'kg']]
for(const [q,u,z] of valid)assert.equal(isValidStockQuantity(q,u,z??false),true,`valid ${q} ${u}`)
for(const [q,u] of invalid)assert.equal(isValidStockQuantity(q,u),false,`invalid ${q} ${u}`)
assert.equal(isValidStockDelta(-0.5,'bloc'),false)
assert.equal(isValidStockDelta(-1,'bloc'),true)
assert.equal(isValidStockDelta(0,'bloc'),true)
assert.equal(requiresInternalManufacturing({category:'Mousse',foamNature:'AGGLO'}),true)
assert.equal(requiresInternalManufacturing({category:'Mousse',foamNature:'PURE'}),false)
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8')
const movements=read('src/app/api/movements/route.ts')
assert.ok(movements.includes('include:{material:{select:{unit:true}}}'))
assert.ok(movements.indexOf('isValidStockQuantity(d.qty,lot.material.unit)')<movements.indexOf('tx.stockLot.updateMany'))
const w=read('src/app/api/p2p/warehouse/route.ts')
assert.ok(w.includes('isValidStockQuantity(d.qty,lot.material.unit)'))
assert.ok(w.includes('isValidStockQuantity(d.observedQty,placement.stockLot.material.unit,true)'))
assert.ok(w.includes('isValidStockQuantity(count.observedQty,countMaterial.unit,true)'))
assert.ok(w.includes('qty:count.expectedQty'), 'compare-and-swap counting')
assert.ok(w.includes('unit:countMaterial.unit'))
assert.ok(w.indexOf('isValidStockQuantity(d.qty,lot.material.unit)')<w.indexOf('tx.stockPlacement.updateMany'))
const r=read('src/app/api/p2p/replenishment/route.ts')
assert.ok(r.includes('isValidStockQuantity(d.qty,m.unit)'))
assert.ok(r.includes('requiresInternalManufacturing(m)'))
assert.ok(r.includes('NO_ACTIVE_SUPPLIER'))
assert.ok(read('src/app/api/materials/route.ts').includes('isValidStockQuantity(data.minStock,data.unit,true)'))
assert.ok(read('src/app/api/materials/[id]/route.ts').includes('isValidStockQuantity(nextMaterial.minStock,nextMaterial.unit,true)'))
assert.ok(read('src/app/api/quality-inspections/route.ts').includes('unit:material.unit'))
assert.ok(read('src/app/api/supplier-returns/route.ts').includes('unit:lot.material.unit'))
for(const route of ['src/app/api/purchases/route.ts','src/app/api/p2p/consultations/route.ts','src/app/api/p2p/sourcing/route.ts','src/app/api/p2p/warehouse/route.ts','src/app/api/materials/da-followup/route.ts']){
 // P5.15.20 : la pagination serveur peut être portée par l'assistant partagé
 // readDocumentPage (déstructuration `skip,take`) depuis P5.15.18, ou par un
 // LIMIT/OFFSET SQL natif (route consultations) ; l'exigence reste une
 // pagination AVANT réponse, matérialisée par pageSize + skip/OFFSET.
 const s=read(route);assert.ok(s.includes('pageSize')&&(s.includes('skip:')||s.includes('skip,take')||s.includes('metadata.slice(')||s.includes('OFFSET')),route)
}
const pkg=JSON.parse(read('package.json'))
// Les invariants P5.15.2 doivent rester valides dans les versions correctives suivantes.
// P6 (2026-11-11) : lignage P5.15.2x OU P6.15.30+ (l'audit P6 conserve
// toutes les garanties d'intégrité de P5.15.2x, elles sont re-testées).
assert.ok(/p[56]\.15\.(?:[2-9]|[1-9]\d+)/.test(pkg.version), 'lignage P5.15.2x/P6 requis: '+pkg.version)
assert.ok(pkg.scripts['test:regression:runtime'].includes('test:v18913p5152'))
console.log(`PASS P5.15.2: ${valid.length+invalid.length+3} garde quantités, chemins stock, réapprovisionnement, catalogue, pagination, CI`)
