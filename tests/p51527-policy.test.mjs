import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('rejected material receipts cannot exhaust active capacity',()=>{
 const s=read('src/app/api/production-stock/receipts/route.ts')
 assert.match(s,/status:\{in:\['quarantine','released'\]\}/)
 assert.match(s,/replacementReceiptId/);assert.match(s,/REPLACEMENT_TRACE_REQUIRED/)
})
test('rejected finished lots cannot exhaust active capacity',()=>{
 const s=read('src/app/api/sales/finished-stock/route.ts')
 assert.match(s,/status:\{in:\['quarantine','available','exhausted'\]\}/)
 assert.match(s,/replacementLotId/);assert.match(s,/SELF_QUALITY_APPROVAL/)
})
test('finance must approve standard cost before stock movement',()=>{
 const s=read('src/app/api/production-stock/receipts/route.ts')
 assert.match(s,/MTS_COST_NOT_APPROVED/);assert.match(s,/receivedWeightedAverageCost/)
 const f=read('src/app/api/production-stock/cost/route.ts')
 assert.match(f,/hasRole\(req,'finance'\)/);assert.match(f,/SELF_APPROVAL/)
})
test('ownership and dates validated by API',()=>{
 assert.match(read('src/app/api/stock-planning/route.ts'),/CANCEL_NOT_OWNER/)
 assert.match(read('src/app/api/production-stock/route.ts'),/Date de fin avant le debut/)
})
