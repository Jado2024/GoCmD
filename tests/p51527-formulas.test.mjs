import {test} from 'node:test'
import assert from 'node:assert/strict'
import {pointOfReorder,safetyStock,movingAverage,wape,lotAdjustedQty} from '../src/lib/production-planning-formulas.ts'
test('point de commande, délai et stock sécurité',()=>{assert.equal(pointOfReorder(10,5,20),70);assert.throws(()=>pointOfReorder(10,-1,0))})
test('stock de sécurité z et variabilité',()=>{assert.equal(safetyStock(10,2,4,0,1.65),6.6);assert.ok(safetyStock(10,2,4,2,1.65)>6.6)})
test('moyenne mobile sans inventer historique',()=>{assert.equal(movingAverage([3,6,9,12],2),10.5);assert.throws(()=>movingAverage([3],2))})
test('WAPE zéro dénominateur et prix de prévision',()=>{assert.equal(wape([10,10],[8,12]),20);assert.equal(wape([0],[0]),null)})
test('lot minimum, multiples, quantités non valides',()=>{assert.equal(lotAdjustedQty(13,8,5),15);assert.equal(lotAdjustedQty(0,8,5),0);assert.throws(()=>lotAdjustedQty(13,8,0))})
