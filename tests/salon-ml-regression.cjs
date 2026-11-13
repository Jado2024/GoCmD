const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
// Tests métier isolés, sans installation de Next.js ni connexion réseau.
require.extensions['.ts']=(mod,filename)=>{
  const src=fs.readFileSync(filename,'utf8')
  const js=ts.transpileModule(src,{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  mod._compile(js,filename)
}
const { buildPieces }=require('../src/lib/order-pieces.ts')
const dims={lengthCm:100,widthCm:65,heightCm:25}
function P(ref,billed,count=1,code='STD',extra={}){
 return {label:'Salon Alcyon',partRef:ref,linearMeters:billed,gabaritCode:code,billingMode:code==='STD'?'manual':'computed',shape:code==='STD'?'rectangle':'gabarit',...dims,count,extra}
}
function order(ensembleCount=2,quantity=8.8,parts=[P('L01',2.6),P('L02',1.8)]){
 return {orderRef:'CMD-TEST-001',lineNo:1,label:'Salon Alcyon',family:'SALON',unit:'ml',quantity,ensembleCount,parts,defaultDimensions:dims}
}
const pieces=buildPieces(order())
assert.equal(pieces.length,4)
assert.deepEqual(pieces.map(p=>p.salonNo),[1,1,2,2])
assert.deepEqual(pieces.map(p=>p.partRef),['L01','L02','L01','L02'])
assert.equal(new Set(pieces.map(p=>p.code)).size,4)
assert.ok(Math.abs(pieces.reduce((s,p)=>s+p.linearMeters,0)-8.8)<1e-8)
assert.ok(pieces.every(p=>p.linearMeters>0))
assert.throws(()=>buildPieces(order(2,8.7)),/somme des métrages/)
assert.throws(()=>buildPieces({...order(),unit:'u',quantity:2}),/mètre linéaire/)
assert.throws(()=>buildPieces(order(0,0)),/Quantité commerciale|Quantité d'ensembles/)
assert.throws(()=>buildPieces(order(51,224.4)),/Quantité d'ensembles/)
assert.throws(()=>buildPieces(order(2,8.8,[P('L01',-1),P('L02',1.8)])),/Métrage/)
const straight=buildPieces({orderRef:'CMD-BQ-01',lineNo:1,label:'Banquette',family:'BANQUETTE',unit:'ml',quantity:5.2,parts:[P('L01',2.6,2)],defaultDimensions:dims})
assert.equal(straight.length,2)
assert.equal(straight.reduce((s,p)=>s+p.linearMeters,0),5.2)
const mattresses=buildPieces({orderRef:'CMD-MA-01',lineNo:1,label:'Matelas',family:'MATELAS',unit:'u',quantity:2,parts:[P('L01',undefined)],defaultDimensions:dims})
assert.equal(mattresses.length,2)
const L=0.65,S=Math.hypot(.65,.2),T=S
const gaba21=P('L01',1.4,1,'21',{D:1.4,J:1,S,T})
const geoSalon=buildPieces(order(2,2.8,[gaba21]))
assert.equal(geoSalon.length,2)
assert.ok(Math.abs(geoSalon[0].linearMeters-1.4)<1e-8)
assert.equal(geoSalon[0].gabaritCode,'21')
assert.throws(()=>buildPieces(order(1,3,[gaba21])),/somme des métrages/)
console.log('OK: 15 assertions salon/ml, répartition, doublons, gabarit 21, rejets, banquette et matelas.')
