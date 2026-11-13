import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceIsValid} from '../src/lib/supplier-price-authorization.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const today=new Date('2026-11-04T10:00:00Z');
const contract={type:'CONTRACT',id:1,supplierId:12,materialId:5,unitPrice:300,ref:'ACC-TEST',validFrom:'2026-11-01',validUntil:'2026-12-31',approved:true};
const quote={type:'QUOTE',id:2,supplierId:12,materialId:5,requestLineId:42,unitPrice:310,ref:'DEV-TEST',validUntil:'2026-11-30',offeredQty:200,approved:true};
const args={supplierId:12,materialId:5,requestLineId:42,qty:100,unitPrice:300,today};
assert.equal(sourceIsValid(contract,args),true);
for(const altered of [{approved:false},{validUntil:'2026-11-01'},{validFrom:'2026-11-05'},{supplierId:13},{materialId:6},{unitPrice:350}]){
 assert.equal(sourceIsValid({...contract,...altered},args),false,JSON.stringify(altered));
}
assert.equal(sourceIsValid(quote,{...args,unitPrice:310}),true);
assert.equal(sourceIsValid(quote,{...args,unitPrice:310,requestLineId:43}),false);
assert.equal(sourceIsValid(quote,{...args,unitPrice:310,qty:201}),false);
assert.equal(sourceIsValid({...quote,approved:false},{...args,unitPrice:310}),false);
assert.equal(sourceIsValid({...quote,validUntil:null},{...args,unitPrice:310}),false);
for(const f of ['src/app/api/supplier-orders/route.ts','src/app/api/supplier-orders/[id]/route.ts']){
 const content=read(f);
 assert.match(content,/PRICE_NOT_AUTHORIZED/);
 assert.match(content,/sourceIsValid/);
}
const order=read('src/app/api/supplier-orders/route.ts');
assert.match(order,/sourceType:z.enum\(\["CONTRACT","QUOTE"\]\)/);
assert.match(order,/priceSourceRef:authorisedSources/);
assert.match(order,/QUOTE_QTY_EXCEEDED/);
const sourcing=read('src/app/api/p2p/sourcing/route.ts');
for(const action of ['agreement','approveAgreement','revokeAgreement','offer','award','rfq'])assert.ok(sourcing.includes(`d.action==='${action}'`),action);
assert.match(sourcing,/AUTO_APPROBATION_CONTRAT/);
assert.match(sourcing,/AUTO_ATTRIBUTION/);
assert.match(read('prisma/schema.prisma'),/model SupplierPriceAgreement/);
assert.match(read('src/components/erp/supply-chain-view.tsx'),/Devis ou contrat requis/);
console.log('PASS P5.11 : 16 contrôles sources tarifaires + gardes API / UI.');
