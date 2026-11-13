import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const get=x=>readFileSync(new URL(`../${x}`,import.meta.url),'utf8')
test('plafond OF client fondé sur les mouvements reçus et non le solde lots',()=>{
 const x=get('src/app/api/sales/finished-stock/route.ts')
 assert.match(x,/finishedStockMovement\.aggregate\(\{where:\{type:"received_quarantine",lot:\{workOrderId:wo\.id\}/)
 assert.doesNotMatch(x,/finishedStockLot\.aggregate\(\{where:\{workOrderId:wo\.id\}/)
})
test('DPR avec OF autonome, validation nominative avant création, clôture sur cumul qualité',()=>{
 const x=get('src/app/api/stock-planning/route.ts')
 assert.match(x,/if\(d\.action==='approve'\)\{[\s\S]*productionStockOrder\.create/)
 assert.match(x,/order\?\.status!=='completed'/)
 assert.match(x,/finishedStockMovement\.aggregate/)
 assert.match(x,/productionMaterialReceipt\.aggregate/)
})
test('référence libre interdite et fabrication MTS achevée exigée',()=>{
 const x=get('src/app/api/sales/finished-stock/route.ts')
 assert.match(x,/SOURCE_NOT_APPROVED/)
 assert.match(x,/request\.stockOrder\?\.status!=='completed'/)
 assert.match(x,/finishedStockMovement\.aggregate/)
})
test('qualité distincte du magasin, seuil sur cumul recep matières',()=>{
 const x=get('src/app/api/production-stock/receipts/route.ts')
 assert.match(x,/receipt\.receivedBy===actor/)
 assert.match(x,/productionMaterialReceipt\.aggregate/)
 assert.match(x,/placeReceipt/)
 assert.match(x,/movePlacement/)
})
test('production possède droits API distincts achats et commerciaux',()=>{
 const directory=get('src/lib/user-directory.cjs')
 const planning=get('src/app/api/stock-planning/route.ts')
 assert.match(directory,/production\.approve/) 
 assert.match(directory,/production\.close/)
 assert.match(planning,/hasRole\(req,'production'\)/)
 assert.doesNotMatch(planning,/function canApprove\(req:NextRequest\)\{return hasRole\(req,'approver'\)/)
})

test('aucune liberation alternative MTS par circuit achat',()=>{
 const x=get('src/app/api/quality-inspections/route.ts')
 assert.match(x,/from\.provenanceKey\.startsWith\('MTS-'\)/)
})
