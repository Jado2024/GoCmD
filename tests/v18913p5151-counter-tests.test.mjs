import assert from 'node:assert/strict';
import fs from 'node:fs';
import {remainingToOrder} from '../src/lib/purchase-availability.ts';
import {summarizeMaterialDa,daAvailableCoverage,daOpenQty} from '../src/lib/material-da-summary.ts';
import {isValidPurchaseQuantity} from '../src/lib/purchase-quantity.ts';

const order=(status,qty,receivedQty=0,ref='BC')=>({qty,receivedQty,order:{status,ref}});
const scenario=(id,qty,receivedQty,orders)=>({id,ref:`DA-${id}`,status:'partial',createdAt:'2026-11-05T08:00:00Z',expectedDate:null,
  lines:[{id,materialId:1,qty,approvedQty:qty,receivedQty,supplierOrderLines:orders}]});
// GC-01, every open balance must be exactly the server's remainingToOrder.
for(const [name,receivedQty,orders,expected] of [
 ['aucun BC',0,[],100],
 ['brouillon non engage',0,[order('draft',80)],100],
 ['BC clos sans livraison',0,[order('closed',80)],100],
 ['BC clos apres BR partiel',20,[order('closed',80,20)],80],
 ['BC confirme',0,[order('confirmed',80)],20],
 ['BC partiel',20,[order('partial',80,20)],20],
 ['BC receptionne',80,[order('received',80,80)],20],
 ['BC ferme + encore ouvert',20,[order('closed',40,20),order('confirmed',50)],30],
 ]){
  const r=scenario(1,100,receivedQty,orders),line=r.lines[0];
  assert.equal(remainingToOrder(line),expected,name+' serveur');
  const summary=summarizeMaterialDa([r])[1];
  assert.equal(summary.approvedQty,expected,name+' interface');
  assert.equal(summary.history[0].approvedToOrderQty,expected,name+' historique');
}
// GC-02 drafts can exceed approved quantity but MUST be signalled, never treated as confirmed cover.
const drafts=summarizeMaterialDa([scenario(2,100,0,[order('draft',80,0,'B1'),order('draft',80,0,'B2')])])[1];
assert.equal(drafts.draftQty,160);
assert.equal(drafts.draftExcessQty,60);
assert.equal(drafts.approvedQty,100);
assert.equal(daOpenQty(drafts),100);
assert.equal(daAvailableCoverage(drafts),100);
assert.equal(summarizeMaterialDa([scenario(3,100,0,[order('draft',20)])])[1].draftExcessQty,0);
// GC-03 no half block, no overprecision, valid fractional unit supported.
assert.equal(isValidPurchaseQuantity(0.5,'bloc'),false);
assert.equal(isValidPurchaseQuantity(1,'bloc'),true);
assert.equal(isValidPurchaseQuantity(0.125,'ml'),true);
assert.equal(isValidPurchaseQuantity(0.1234,'kg'),false);
const read=(file)=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const quality=read('src/app/api/quality-inspections/route.ts');
assert.ok(quality.includes('isValidPurchaseQuantity(d.qty,material.unit)'));
assert.ok(quality.indexOf('isValidPurchaseQuantity(d.qty,material.unit)')<quality.indexOf('tx.stockLot.updateMany'));
assert.ok(quality.includes('QTE_UNITE_INVALIDE:'));
const history=read('src/app/api/purchases/[id]/history/route.ts');
assert.ok(history.includes('orderBy:{id:"desc"}')&&history.includes('id:{lt:cursor}')&&history.includes('take:rawLimit+1'));
assert.ok(history.includes('readRoleGate(req,["buyer","approver"])'));
assert.ok(!read('src/app/api/purchases/route.ts').includes('take:3000'));
assert.ok(read('src/components/erp/purchases-view.tsx').includes('history.fetchNextPage()'));
assert.ok(read('src/components/erp/materials-view.tsx').includes('summary?.draftExcessQty'));
// GC-05 no implicit admin procurement reader.
assert.ok(read('src/app/api/purchases/route.ts').includes('readRoleGate(req, ["buyer", "approver"])'));
console.log('PASS P5.15.1 : 8 cas BC/DA, brouillons concurrents, contrôle unité qualité, journal paginé, RBAC lecture, UI.');
