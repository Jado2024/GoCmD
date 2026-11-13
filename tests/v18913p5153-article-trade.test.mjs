import assert from 'node:assert/strict'
import fs from 'node:fs'
import {validTradePolicy,stockForSale,validateSalesSettings} from '../src/lib/article-trade.ts'
const tests=[
  [stockForSale(1,'bloc','bloc',1),1],
  [stockForSale(0.5,'bloc','bloc',1),null],
  [stockForSale(1.125,'m','m',1),1.125],
  [stockForSale(1,'rouleau','m',50),50],
  [stockForSale(0.5,'rouleau','m',50),null],
  [stockForSale(1,'bloc','bloc',0.5),null],
  [stockForSale(1.1234,'m','m',1),null],
  [stockForSale(1000001,'m','m',1),null],
  [validateSalesSettings('m','rouleau',50,250),true],
  [validateSalesSettings('bloc','bloc',0.5,250),false],
  [validateSalesSettings('bloc','bloc',1,250.123),false],
  [validTradePolicy({isPurchasable:false,isManufactured:true,isSellable:true,isInternalUse:true},'AGGLO','Mousse'),true],
  [validTradePolicy({isPurchasable:true,isManufactured:true,isSellable:true,isInternalUse:true},'AGGLO','Mousse'),false],
  [validTradePolicy({isPurchasable:false,isManufactured:false,isSellable:true,isInternalUse:true},'PURE','Mousse'),false],
]
for(const [actual,want] of tests)assert.deepEqual(actual,want)
const root=new URL('../',import.meta.url)
const read=file=>fs.readFileSync(new URL(file,root),'utf8')
const sales=read('src/app/api/sales/route.ts')
assert.ok(sales.includes('stockForSale(requested.qty,line.unit,material.unit,line.stockUnitsPerSale)'))
assert.ok(sales.includes('stockLot.updateMany')&&sales.includes('reducePlacement(tx,lot.id,quantity)')&&sales.includes('material.updateMany')&&sales.includes('salesStockAllocation.create'))
assert.ok(sales.includes('db.$transaction(async tx=>'))
assert.ok(sales.indexOf('stockLot.updateMany')<sales.indexOf('salesStockAllocation.create'))
assert.ok(sales.includes('status:"available"')&&sales.includes('expiresAt:{gt:new Date()}'))
assert.ok(read('src/app/api/orders/route.ts').includes('stockUnitsPerSale:l.product.materialId==null?1:l.product.unitsPerSale'))
assert.ok(read('src/app/api/purchases/route.ts').includes('!m.isPurchasable'))
assert.ok(read('src/app/api/materials/route.ts').includes('tx.product.create'))
assert.ok(read('src/app/api/materials/[id]/route.ts').includes('status:"inactive"'))
assert.ok(read('src/components/erp/sales-view.tsx').includes('stockLines,note:reason'))
console.log('PASS P5.15.3: 14 tests unitaires + contrôles statiques catalogue/commandes/BL/stock')
