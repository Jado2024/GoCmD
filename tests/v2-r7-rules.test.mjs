// Runtime verification: imports TypeScript modules without network/npm, via global TS transpilation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync,existsSync } from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const Module=require('node:module');
const ts=require('typescript');
const cache=new Map();
function load(file){
 file=path.resolve(file); if(cache.has(file))return cache.get(file).exports;
 const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));cache.set(file,m);
 const source=readFileSync(file,'utf8');
 const code=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 m.require=(name)=>{
  if(name.startsWith('.')){const base=path.resolve(path.dirname(file),name); for(const x of [base+'.ts',base+'.tsx',base+'.js',base])if(existsSync(x))return x.endsWith('.ts')||x.endsWith('.tsx')?load(x):require(x);}
  return require(name);
 };
 m._compile(code,file);return m.exports;
}
const dir=path.resolve('src/lib');
const {buildPieces}=load(path.join(dir,'order-pieces.ts'));
const {genericLineSnapshot,genericVirtualProduct}=load(path.join(dir,'generic-order.ts'));
const d={template:'GEN-DIV',description:'Prestation sans cotes',specifications:'Traitement manuel lot client ponctuel',requiresPreparation:false};
const product=genericVirtualProduct(d,110,-1);
assert.equal(product.length,0);assert.equal(product.width,0);assert.equal(product.height,0);
const snapshot=genericLineSnapshot(d,110,2);
assert.equal(snapshot.dimensions,null);
assert.equal(snapshot.template,'GEN-DIV');assert.equal(snapshot.unitPrice,110);
const pieces=buildPieces({orderRef:'TEST-R7',lineNo:1,label:d.description,family:'DIVERS',unit:'u',quantity:2,
 defaultDimensions:{lengthCm:0,widthCm:0,heightCm:0},dimensionless:true});
assert.equal(pieces.length,2);assert.equal(pieces[1].heightCm,0);
assert.throws(()=>buildPieces({orderRef:'TEST-R7',lineNo:1,label:d.description,family:'DIVERS',unit:'u',quantity:2,
 defaultDimensions:{lengthCm:0,widthCm:0,heightCm:0}}),/Dimensions invalides/);
assert.throws(()=>buildPieces({orderRef:'TEST-R7',lineNo:1,label:d.description,family:'DIVERS',unit:'u',quantity:2,
 defaultDimensions:{lengthCm:10,widthCm:0,heightCm:0},dimensionless:true}),/Dimensions invalides/);
const withDims={...d,lengthCm:120,widthCm:80,heightCm:5};
assert.deepEqual(genericLineSnapshot(withDims,120,1).dimensions,{lengthCm:120,widthCm:80,heightCm:5});
const withDimsPieces=buildPieces({orderRef:'TEST-R7',lineNo:1,label:d.description,family:'DIVERS',unit:'u',quantity:1,defaultDimensions:{lengthCm:120,widthCm:80,heightCm:5}});
assert.equal(withDimsPieces.length,1);
console.log('R7 TypeScript runtime: 9 checks passed (GEN-DIV dimensionless + physical protections).');
