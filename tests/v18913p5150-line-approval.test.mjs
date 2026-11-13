import assert from 'node:assert/strict';
import fs from 'node:fs';
import {evaluateLineDecisions} from '../src/lib/purchase-line-decision.ts';
import {remainingToOrder} from '../src/lib/purchase-availability.ts';
import {summarizeMaterialDa} from '../src/lib/material-da-summary.ts';
const lines=[{id:1,qty:100,unit:'bloc'},{id:2,qty:42,unit:'bloc'}];
const mixed=evaluateLineDecisions(lines,[{lineId:1,decision:'approve'},{lineId:2,decision:'reduce',approvedQty:30,reason:'Besoin réduit par l atelier'}]);
assert.equal(mixed.status,'partially_approved');
assert.deepEqual(mixed.decisions.map(x=>x.approvedQty),[100,30]);
assert.equal(mixed.decisions[1].requestedQty,42);
assert.equal(evaluateLineDecisions(lines,[{lineId:1,decision:'reject',reason:'Stocks déjà suffisants'},{lineId:2,decision:'reject',reason:'Stock disponible interne'}]).status,'rejected');
const one=evaluateLineDecisions(lines,[{lineId:1,decision:'approve'},{lineId:2,decision:'approve'}]);
assert.equal(one.status,'approved');
assert.deepEqual(one.decisions.map(x=>x.approvedQty),[100,42]);
const invalidCases=[
 [{lineId:1,decision:'approve'}],
 [{lineId:1,decision:'approve'},{lineId:1,decision:'approve'}],
 [{lineId:1,decision:'approve'},{lineId:3,decision:'approve'}],
 [{lineId:1,decision:'approve'},{lineId:2,decision:'reduce',approvedQty:43,reason:'Justification très claire'}],
 [{lineId:1,decision:'approve'},{lineId:2,decision:'reduce',approvedQty:0,reason:'Justification très claire'}],
 [{lineId:1,decision:'approve'},{lineId:2,decision:'reduce',approvedQty:2.5,reason:'Justification très claire'}],
 [{lineId:1,decision:'approve'},{lineId:2,decision:'reduce',approvedQty:25,reason:'Court'}],
 [{lineId:1,decision:'approve'},{lineId:2,decision:'reject',reason:'court'}],
 [{lineId:1,decision:'approve'},{lineId:2,decision:'reject',approvedQty:12,reason:'Justification très claire'}],
];
for(const value of invalidCases)assert.throws(()=>evaluateLineDecisions(lines,value));
const demand={qty:42,approvedQty:30,receivedQty:0,supplierOrderLines:[]};
assert.equal(remainingToOrder(demand),30);
assert.equal(remainingToOrder({...demand,approvedQty:0}),0);
assert.equal(remainingToOrder({...demand,receivedQty:10,supplierOrderLines:[{qty:12,receivedQty:4,order:{status:'confirmed'}}]}),12);
const summarised=summarizeMaterialDa([{id:1,ref:'DA-TEST',status:'partially_approved',createdAt:new Date('2026-11-05T08:00Z'),expectedDate:null,lines:[{id:2,materialId:55,qty:42,approvedQty:30,receivedQty:0,supplierOrderLines:[]}]}]);
assert.equal(summarised[55].approvedQty,30);
assert.equal(summarised[55].history[0].qty,42);
assert.equal(summarised[55].history[0].approvedLineQty,30);
const root=new URL('../',import.meta.url);
const read=(x)=>fs.readFileSync(new URL(x,root),'utf8');
const bc=read('src/app/api/supplier-orders/[id]/route.ts');
const rq=read('src/app/api/purchases/[id]/route.ts');
const consult=read('src/app/api/p2p/consultations/route.ts');
assert.ok(bc.includes('demand.approvedQty+0.000001'),'BC approval must cap approved qty');
assert.ok(rq.includes('PURCHASE_LINE_DECIDED')&&rq.includes('evaluateLineDecisions'));
assert.ok(consult.includes('remainingToOrder(row)'));
assert.ok(read('src/app/api/supplier-orders/route.ts').includes('remainingToOrder(r)'));
assert.ok(read('src/components/erp/purchases-view.tsx').includes('Demandé</TableHead>'));
assert.ok(read('src/app/api/purchases/route.ts').includes('openOrderRemainingQty:'), 'balance based on open confirmed BC only');
assert.ok(read('src/components/erp/purchases-view.tsx').includes('l.openOrderRemainingQty??0'), 'UI must show open BC remainder, not cancelled balance');
const gr=read('src/app/api/goods-receipts/route.ts');
assert.ok(gr.includes('requestLine.approvedQty-entry.acceptedQty'), 'BR must not receive more than approved');
assert.ok(gr.includes('l.receivedQty>=l.approvedQty'), 'BR completion based on approved not asked');
const quality=read('src/app/api/quality-inspections/route.ts');
assert.ok(quality.includes('request.approvedQty-d.qty'), 'quality release capped by approved qty');
assert.ok(quality.includes('x.receivedQty>=x.approvedQty'), 'quality status completion based on approved qty');
const dialog=read('src/components/erp/consultation-dialog.tsx');
// P5.15.20 : le dialogue de consultation a été réécrit en P5.15.16 (consultations
// multi-DA). L'exclusion des lignes refusées est désormais portée par le filtre
// `visibleLine` (remaining(l)>0 obligatoire) appliqué à la liste `viable` des
// cases à cocher, et par la présélection filtrée sur remaining>0.
assert.ok(dialog.includes('remaining(l)>0')&&dialog.includes('viable.map(')&&dialog.includes('purchase.lines.filter(l=>remaining(l)>0)'), 'refused lines excluded from consult UI');

console.log('PASS P5.15.0 : décisions unitaires, réductions, refus, motifs, unités, reliquat BC/consultation, stock et liens UI/API.');
