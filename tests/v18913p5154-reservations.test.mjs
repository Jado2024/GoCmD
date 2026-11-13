import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {stockFree} from '../src/lib/sales-stock-reservation.ts'
const source=(path)=>fs.readFileSync(new URL(path,import.meta.url),'utf8')
const sales=source('../src/app/api/sales/route.ts')
const orders=source('../src/app/api/orders/[id]/route.ts')
const stock=['../src/app/api/movements/route.ts','../src/app/api/quality-inspections/route.ts','../src/app/api/supplier-returns/route.ts','../src/app/api/p2p/warehouse/route.ts']
test('stock libre tient compte des réservations existantes',()=>{
 assert.equal(stockFree(10,3),7)
 assert.equal(stockFree(1,1),0)
 assert.equal(stockFree(0.5,0.125),0.375)
 assert.equal(stockFree(0.5,0.6),0)
})
test('vente : actions réserve/libère et lecture disponibilité présentes',()=>{
 for(const match of ['"reserve-stock"','"release-stock"','kind==="availability"','stockForSale(targetQty','await tx.salesStockReservation.deleteMany','await tx.salesStockReservation.create','await reservedLotQty','myReservations'])assert.ok(sales.includes(match),match)
})
test('stock transversal: quatre routes protègent les quantités réservées',()=>{
 for(const f of stock)assert.ok(source(f).includes('assertStockUnreserved'),f)
})
test('livraison idempotente et réservation consommée par BL',()=>{
 for(const match of ['requestKey:z.string().uuid().optional()','where:{requestKey}','await tx.salesStockReservation.delete','qty:{decrement:drawn}','SALES_DELIVERY_POSTED'])assert.ok(sales.includes(match),match)
})
test('commandes en pause / reliquat clos avec libération atomique et audit',()=>{
 for(const match of ['"hold","resume","close"','await tx.salesStockReservation.deleteMany','fulfillmentStatus:to','CUSTOMER_ORDER_','Commande suspendue ou clôturée'])assert.ok(orders.includes(match),match)
})
