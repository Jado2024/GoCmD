const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const root=path.resolve(__dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gocmd-v1893-'));
for (const file of ['geometry-engine','gabarits','order-pieces','product-taxonomy']) {
  const source=fs.readFileSync(path.join(root,'src','lib',file+'.ts'),'utf8');
  fs.writeFileSync(path.join(dir,file+'.js'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText);
}
const {automaticBilledLength}=require(path.join(dir,'geometry-engine'));
const {billingIsManual}=require(path.join(dir,'gabarits'));
const {buildPieces}=require(path.join(dir,'order-pieces'));
const {unitForFamily,validateTechnicalSpecs}=require(path.join(dir,'product-taxonomy'));
assert.equal(automaticBilledLength('11',{D:2.6,J:2.2}),2.6);
assert.equal(billingIsManual('11'),false);
assert.equal(billingIsManual('12'),true);
assert.throws(()=>automaticBilledLength('11',{D:0,J:2}),/D positif/);
const b={orderRef:'CMD-TEST',lineNo:1,label:'Ouate',family:'OUATE',unit:'kg',quantity:4.75,defaultDimensions:{lengthCm:1,widthCm:1,heightCm:1}};
const pieces=buildPieces(b);
assert.equal(pieces.length,1);assert.equal(pieces[0].linearMeters,null);
assert.equal(unitForFamily('OUATE'),'kg');
assert.equal(validateTechnicalSpecs({family:'OUATE'}),null);
assert.throws(()=>buildPieces({...b,pieceCount:2}),/lot commercial/);
assert.equal(unitForFamily('SALON'),'ml');
const salonParts=Array.from({length:4},(_,i)=>({label:'Banquette',partRef:`L0${i+1}`,linearMeters:2.2,gabaritCode:'STD',shape:'rectangle',count:1,lengthCm:100,widthCm:60,heightCm:28}));
const salonBuilt=buildPieces({orderRef:'CMD-SALON-TEST',lineNo:1,label:'Salon 4 pièces',quantity:8.8,family:'SALON',unit:'ml',ensembleCount:1,parts:salonParts,defaultDimensions:{lengthCm:100,widthCm:60,heightCm:28}});
const linear=salonBuilt.reduce((s,p)=>s+(p.linearMeters||0),0);
assert.ok(Math.abs(linear-8.8)<1e-10);
assert.equal(Math.round(linear*235*100),206800); // 2 068,00 MAD

console.log('PASS V18.9.3 — Gabarit 11 D, ouate kg, 1 lot, contrôle technique et unités');
