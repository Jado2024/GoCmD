/* Regression smoke test of the actual TypeScript label generator. No Prisma runtime needed. */
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const ts=require('typescript')
require.extensions['.ts']=(mod,file)=>{
 const text=fs.readFileSync(file,'utf8');
 const js=ts.transpileModule(text,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 mod._compile(js,file);
};
const root=path.resolve(__dirname,'..');
const {buildPieces}=require(path.join(root,'src/lib/order-pieces.ts'));
const dims={lengthCm:200,widthCm:90,heightCm:20};
function base(q){return {orderRef:'TEST-2026-0301',lineNo:1,label:'Matelas',quantity:q,unit:'u',family:'MATELAS',defaultDimensions:dims}}
const pcs=buildPieces(base(4));
assert.equal(pcs.length,4,'4 matelas must produce exactly 4 labels');
assert.equal(new Set(pcs.map(x=>x.code)).size,4,'label codes unique');
assert.throws(()=>buildPieces({...base(4),pieceCount:4}),/une seule étiquette/);
assert.throws(()=>buildPieces({...base(4),parts:[{label:'Matelas',shape:'rectangle',count:4,...dims}]}),/une seule pièce/);
assert.throws(()=>buildPieces(base(1.5)),/entière/);
const read=(f)=>fs.readFileSync(path.join(root,f),'utf8');
assert.match(read('src/app/api/supplier-orders/[id]/route.ts'),/select:\{requestLine:\{select:\{requestId:true/);
assert.match(read('src/app/api/supplier-orders/[id]/route.ts'),/Number\.isSafeInteger\(r\.requestLine\.requestId\)/);
assert.match(read('src/app/api/supplier-orders/route.ts'),/nextRef\("BC","supplierOrder",tx\)/);
assert.match(read('src/app/api/supplier-returns/route.ts'),/nextRef\("RF","supplierReturn",tx\)/);
assert.match(read('src/app/api/dashboard/route.ts'),/legacy_unverified|unverifiedLots/);
assert.match(read('src/app/api/dashboard/route.ts'),/signedQty:\{not:null\}/);
assert.match(read('src/app/api/materials/route.ts'),/MATERIAL_CREATED/);
assert.match(read('src/app/api/materials/[id]/route.ts'),/UNIT_HAS_HISTORY/);
assert.match(read('src/app/api/orders/[id]/route.ts'),/CUSTOMER_ORDER_ADVANCED/);
assert.match(read('src/app/api/products/[id]/route.ts'),/PRODUCT_UPDATED/);
assert.match(read('src/app/api/stock-lots/route.ts'),/recommendedLotId/);
assert.match(read('src/app/api/quality-inspections/route.ts'),/LEGACY_NOT_COUNTED/);
assert.match(read('src/app/api/p2p/replenishment/route.ts'),/DA_ALREADY_OPEN/);
const files=[];function walk(d){for(const entry of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,entry.name);if(entry.isDirectory())walk(f);else if(/\.tsx?$/.test(entry.name))files.push(f)}}walk(path.join(root,'src'));
let errors=0;for(const f of files){const source=ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);errors+=source.parseDiagnostics.length;}
assert.equal(errors,0,`${errors} TypeScript syntax errors`);
console.log(`PASS V09: 4 unit labels for 4 mattresses; invalid counts rejected; 12 API invariants checked; ${files.length} TS/TSX syntax parses. HTTP/runtime and type-check NOT covered.`);
