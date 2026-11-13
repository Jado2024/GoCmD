/** Node 22 + TypeScript global: tests de logique métier, sans dépendance Next/Prisma. */
const assert=require('node:assert/strict');
const ts=require('typescript');
const fs=require('fs'), os=require('os'), path=require('path');
const base=path.resolve(__dirname,'..');
const dest=fs.mkdtempSync(path.join(os.tmpdir(),'gocmd-check-'));
for (const filename of ['gabarits','geometry-engine','order-pieces']) {
 const input=path.join(base,'src','lib',filename+'.ts');
 const output=ts.transpileModule(fs.readFileSync(input,'utf8'),{fileName:input,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 fs.writeFileSync(path.join(dest,filename+'.js'),output);
}
const {buildPieces}=require(path.join(dest,'order-pieces.js'));
const {GABARITS}=require(path.join(dest,'gabarits.js'));
const {geometryTrapeze, geometryStep, geometryPointes, automaticBilledLength}=require(path.join(dest,'geometry-engine.js'));
const baseInput={orderRef:'CMD-2026-0111',lineNo:1,label:'BANQUETTE ARVENA 100x65x25',family:'BANQUETTE',unit:'ml',quantity:5.58,defaultDimensions:{lengthCm:100,widthCm:65,heightCm:25}};
const part=(partRef,linearMeters,gabaritCode,extra={})=>({label:baseInput.label,partRef,linearMeters,gabaritCode,shape:gabaritCode==='STD'?'rectangle':'gabarit',count:1,lengthCm:100,widthCm:65,heightCm:25,extra});
const pieces=buildPieces({...baseInput,quantity:4.9,parts:[part('L01',2.6,'STD'),part('L02',1.6,'STD'),part('L01',0.7,'06')]});
assert.equal(pieces.length,3);
assert.equal(new Set(pieces.map(p=>p.code)).size,3);
assert.deepEqual(pieces.map(p=>p.partRef),['L01','L02','L01']);
assert.deepEqual(pieces.map(p=>p.linearMeters),[2.6,1.6,0.7]);
assert.equal(pieces[2].gabaritCode,'06');
assert.equal(GABARITS.some(g=>g.code==='52'),false);
assert.throws(()=>buildPieces({...baseInput,quantity:1.38,parts:[part('L03',1.38,'52')]}),/inconnu/);
// Les mesures S/T désignent les OBLIQUES, pas les projections horizontales.
const L=0.65, J=2.5, sh=0.3, th=0.2
const S=Math.hypot(L,sh),T=Math.hypot(L,th)
const expectedByCode={21:{D:3.0,gross:3.0},22:{D:2.0,gross:2.5},23:{D:2.4,gross:2.7},24:{D:2.6,gross:2.8}}
for (const [code,{D,gross}] of Object.entries(expectedByCode)) {
 const geo=geometryTrapeze(code,{D,J,L,S,T})
 assert.ok(geo.coherent,`cohérence ${code}`)
 assert.ok(Math.abs(geo.horizontalLeftM-sh)<1e-9,`projection S ${code}`)
 assert.ok(Math.abs(geo.horizontalRightM-th)<1e-9,`projection T ${code}`)
 assert.ok(Math.abs(geo.expectedD-D)<1e-9,`dos theorique ${code}`)
 assert.ok(Math.abs(geo.grossLengthM-gross)<1e-9,`brut ${code}`)
 assert.ok(geo.wasteAreaM2>=0 && geo.wasteAreaM2<geo.grossAreaM2,`chute ${code}`)
 assert.ok(geo.angleLeftDegrees>0 && geo.angleLeftDegrees<=90,`angle gauche ${code}`)
 assert.ok(geo.angleRightDegrees>0 && geo.angleRightDegrees<=90,`angle droit ${code}`)
 assert.ok(Math.abs(geo.lengthBilledM-(['21','22'].includes(code)?Math.max(D,J):gross))<1e-9,`règle atelier ${code}`)
 const expectedBilling=['21','22'].includes(code)?Math.max(D,J):gross
 const p=part('L01',expectedBilling,code,{D,J,S,T})
 const created=buildPieces({...baseInput,quantity:expectedBilling,parts:[{...p,billingMode:'computed'}]})
 const extra=JSON.parse(created[0].dimensionsExtra)
 assert.equal(extra.L,0.65,`catalogue largeur pour ${code}`) // widthCm=65 fourni au serveur
 assert.equal(extra.D,D)
 assert.equal(extra.J,J)
 assert.equal(extra.S,S)
 assert.equal(extra.T,T)
 assert.equal(created[0].billingMode,'computed')
}
const incoherent=geometryTrapeze('23',{D:3.1,J,L,S,T})
assert.equal(incoherent.coherent,false)
assert.ok(Math.abs(incoherent.expectedD-2.4)<1e-9)
assert.throws(()=>geometryTrapeze('23',{D:2.4,J,L,S:0.5,T}),/Obliques/)
assert.throws(()=>buildPieces({...baseInput,quantity:2,parts:[part('L01',2,'23',{D:2,J,S:0.5,T})]}),/Obliques/)
assert.throws(()=>buildPieces({...baseInput,quantity:2.7,parts:[{...part('L01',2.7,'23',{D:2.4,J,S:0.5,T}),billingMode:'computed'}]}),/Obliques/)
assert.throws(()=>buildPieces({...baseInput,quantity:2.7,parts:[part('L01',2.7,'23',{D:2.4,J,S,T,L:0.5})]}),/largeur du code article/)
// 11 : règle métier SODEPI confirmée : longueur facturée = D, pas J.
const c11=geometryTrapeze('11',{D:2.6,J:2.2,L:0.65})
assert.ok(Math.abs(c11.slopeRightM-Math.hypot(0.65,0.4))<1e-10)
assert.equal(c11.lengthBilledM,2.6)
const piece11=buildPieces({...baseInput,quantity:2.6,parts:[{...part('L01',2.6,'11',{D:2.6,J:2.2}),billingMode:'computed'}]})
assert.equal(piece11[0].linearMeters,2.6)
assert.equal(piece11[0].billingMode,'computed')
assert.equal(JSON.parse(piece11[0].dimensionsExtra).L,0.65)
assert.throws(()=>buildPieces({...baseInput,quantity:2.2,parts:[{...part('L01',2.2,'11',{D:2.6,J:2.2}),billingMode:'computed'}]}),/métrage transmis incohérent/)
// 12 à 14, pas encore de formule usine autorisée : métrage commercial manuel.
for (const [code,D,j] of [['12',2.2,2.6],['13',2.6,2.2],['14',2.2,2.6]]) {
 const geo=geometryTrapeze(code,{D,J:j,L:0.65})
 assert.equal(geo.lengthBilledM,null)
 assert.ok(geo.slopeLeftM!==null || geo.slopeRightM!==null)
}


// Toutes les encoches : dimensions contrôlées, surface brute et chute.
for (const code of ['31','32']) {
 const geo=geometryStep(code,{D:2.5,J:2.5,L:0.65,B:0.25,P:0.1,S:0.4})
 assert.ok(geo.coherent)
 assert.ok(Math.abs(geo.wasteAreaM2-0.04)<1e-9)
 assert.equal(geo.grossLengthM,2.5)
 const built=buildPieces({...baseInput,quantity:2.5,parts:[part('L01',2.5,code,{D:2.5,J:2.5,B:0.25,P:0.1,S:0.4})]})
 assert.ok(JSON.parse(built[0].dimensionsExtra).surfaceChutesTheoriqueM2>0)
 assert.equal(built[0].billingMode,'computed')
 assert.equal(built[0].linearMeters,2.5)
}
for (const code of ['33','34']) {
 const geo=geometryStep(code,{D:2.1,J:2.4,L:0.65,P:0.1,S:0.3})
 assert.ok(geo.coherent)
 assert.ok(Math.abs(geo.wasteAreaM2-0.03)<1e-9)
 assert.equal(geo.grossLengthM,2.4)
 const built=buildPieces({...baseInput,quantity:2.4,parts:[{...part('L01',undefined,code,{D:2.1,J:2.4,P:0.1,S:0.3}),billingMode:'computed'}]})
 assert.equal(built[0].billingMode,'computed')
 assert.equal(built[0].linearMeters,2.4)
}
assert.throws(()=>geometryStep('31',{D:2,J:2,L:0.65,P:0.7,S:0.2,B:0.2}),/Profondeur/)
assert.throws(()=>geometryStep('32',{D:2,J:2,L:0.65,P:0.1,S:0.3,B:1.9}),/B \+ S/)
assert.equal(geometryStep('33',{D:2,J:2.4,L:0.65,P:0.1,S:0.3}).coherent,false)
// Gabarits 41 et 51 : angles obligatoires 45° et H hauteur totale (PAS angle libre).
const known41={J:1.2,W:2.0};
known41.K=known41.W/Math.SQRT2;
known41.L=(known41.W-known41.J)/Math.SQRT2;
const H41=known41.W-known41.J/2;
const geo41=geometryPointes('41',{J:known41.J,K:known41.K,L:known41.L,H:H41});
assert.ok(Math.abs(geo41.distancePointesM-known41.W)<1e-9);
assert.ok(Math.abs(geo41.hauteurCalculeeM-H41)<1e-9);
assert.equal(geo41.angleKDeg,45);assert.equal(geo41.angleLDeg,45);
assert.ok(geo41.areaM2>0 && geo41.wasteAreaM2>0);
const c41=buildPieces({...baseInput,quantity:known41.W,parts:[{...part('L01',undefined,'41',{J:known41.J,L:known41.L,K:known41.K,H:H41}),billingMode:'computed'}]});
assert.ok(Math.abs(c41[0].linearMeters-known41.W)<1e-9);
assert.ok(Math.abs(JSON.parse(c41[0].dimensionsExtra).W-known41.W)<1e-9);
assert.throws(()=>buildPieces({...baseInput,quantity:2,parts:[part('L01',undefined,'41',{J:known41.J,L:known41.L,K:known41.K,H:H41,W:2})]}),/ne pas le saisir/);
assert.throws(()=>geometryPointes('41',{J:known41.J,L:known41.L,K:known41.K*0.8,H:H41}),/45°/);
assert.throws(()=>geometryPointes('41',{J:known41.J,L:known41.L,K:known41.K,H:20}),/45°|incompatibles/);
assert.ok(Math.abs(automaticBilledLength('41',{J:known41.J,K:known41.K,L:known41.L,H:H41})-known41.W)<1e-9);
// Exemple de chute : un profil 11 de longueur 2,60/2,20, largeur 0,65 => 0,130 m².
assert.ok(Math.abs(c11.wasteAreaM2-0.13)<1e-9)
assert.ok(Math.abs(c11.angleRightDegrees-Math.atan2(.65,.4)*180/Math.PI)<1e-9)

const manual=buildPieces({...baseInput,quantity:1.5,parts:[part('L03',1.5,'06')]});
assert.equal(manual[0].linearMeters,1.5);
assert.equal(manual[0].gabaritCode,'06');
assert.throws(()=>buildPieces({...baseInput,quantity:6,parts:[part('L01',2.6,'STD')]}),/somme des métrages/);
assert.throws(()=>buildPieces({...baseInput,quantity:1.38,parts:[part('L01',1.38,'52')]}),/inconnu/);
assert.throws(()=>buildPieces({...baseInput,quantity:1,parts:[part('L01',1,'99')]}),/inconnu/);
const salon=buildPieces({...baseInput,unit:'ml',quantity:8,ensembleCount:2,family:'SALON',parts:[part('L01',1.5,'STD'),part('L02',2.5,'STD')]});
assert.equal(salon.length,4);assert.equal(salon[3].salonNo,2);
assert.ok(GABARITS.find(g=>g.code==='06'));
assert.equal(GABARITS.some(g=>g.code==='52'),false);
// Contrôles atelier de la longueur facturée, indépendants des cotes brutes.
assert.equal(automaticBilledLength('21',{D:3.0,J:2.5}),3.0)
assert.equal(automaticBilledLength('22',{D:2.0,J:2.5}),2.5)
for (const g of ['31','32','33','34']) assert.equal(automaticBilledLength(g,{D:2.1,J:2.4}),2.4)
assert.ok(Math.abs(automaticBilledLength('23',{D:2.4,J,L,S,T})-2.7)<1e-9)
assert.ok(Math.abs(automaticBilledLength('24',{D:2.6,J,L,S,T})-2.8)<1e-9)
assert.throws(()=>automaticBilledLength('21',{D:NaN,J:2.4}),/dos D/)
assert.throws(()=>automaticBilledLength('34',{D:2.3,J:0}),/assise J/)
// Bloquer toute tentative de forcer manuellement une longueur différente.
assert.throws(()=>buildPieces({...baseInput,quantity:3.1,parts:[{...part('L01',3.1,'21',{D:3,J,S,T}),billingMode:'computed'}]}),/incohérent/)
assert.throws(()=>buildPieces({...baseInput,quantity:2.6,parts:[{...part('L01',2.6,'22',{D:2,J,S,T}),billingMode:'manual'}]}),/automatique obligatoire/)
assert.throws(()=>buildPieces({...baseInput,quantity:2.6,parts:[{...part('L01',2.6,'31',{D:2.5,J:2.5,B:0.25,P:0.1,S:0.4}),billingMode:'computed'}]}),/incohérent/)
assert.throws(()=>buildPieces({...baseInput,quantity:2.5,parts:[{...part('L01',2.5,'32',{D:2.5,J:2.5,B:0.25,P:0.1,S:0.4}),billingMode:'manual'}]}),/automatique obligatoire/)
// Audit du rectangle enveloppant : 8 contours, et comparaison aux sommets.
const {rectangleEnveloppant, surfacePolygone}=require(path.join(dest,'geometry-engine.js'));
const envelopeCases=[
 ['11',{D:2.6,J:2.2,L:.65},2.6],['12',{D:2.2,J:2.6,L:.65},2.6],
 ['13',{D:2.6,J:2.2,L:.65},2.6],['14',{D:2.2,J:2.6,L:.65},2.6],
 ['21',{D:3.0,J:2.5,L,S,T},3.0],['22',{D:2.0,J:2.5,L,S,T},2.5],
 ['23',{D:2.4,J:2.5,L,S,T},2.7],['24',{D:2.6,J:2.5,L,S,T},2.8],
];
for (const [code,values,w] of envelopeCases) {
 const actual=geometryTrapeze(code,values);
 const box=rectangleEnveloppant(actual.verticesM);
 assert.ok(Math.abs(box.longueurBrute-w)<1e-9,`${code}: largeur brute exacte`);
 assert.ok(Math.abs(actual.rectangleMaxXM-actual.rectangleMinXM-w)<1e-9,`${code}: max-min`);
 assert.ok(Math.abs(actual.areaM2-surfacePolygone(actual.verticesM))<1e-9,`${code}: surface polygone`);
 assert.ok(actual.wasteAreaM2>=-1e-12,`${code}: chute non-negative`);
 assert.ok(actual.grossAreaM2+1e-12>=actual.areaM2,`${code}: enveloppe >= forme`);
}
assert.throws(()=>rectangleEnveloppant([{x:0,y:0},{x:2,y:0}]),/Sommets/);
console.log('PASS : 21/22 = MAX(D,J) ; 31-34 = J ; facturation auto contrôlée serveur ; autres règles inchangées')

// 51 : H entre J et D, K et L obligatoirement 45°.
const known51={D:1.5,J:1.3,W:2.4};
known51.K=(known51.W-known51.D)/Math.SQRT2;
known51.L=(known51.W-known51.J)/Math.SQRT2;
const H51=known51.W-(known51.D+known51.J)/2;
const g51=geometryPointes('51',{D:known51.D,J:known51.J,K:known51.K,L:known51.L,H:H51});
assert.ok(Math.abs(g51.distancePointesM-known51.W)<1e-9);
assert.ok(Math.abs(g51.profondeurBruteM-H51)<1e-9);
assert.ok(Math.abs(g51.hauteurCalculeeM-H51)<1e-9);
assert.equal(g51.angleKDeg,45);assert.equal(g51.angleLDeg,45);
const c51=buildPieces({...baseInput,quantity:known51.W,parts:[{...part('L02',undefined,'51',{D:known51.D,J:known51.J,K:known51.K,L:known51.L,H:H51}),billingMode:'computed'}]});
assert.ok(Math.abs(c51[0].linearMeters-known51.W)<1e-9);
assert.equal(c51[0].billingMode,'computed');
assert.throws(()=>buildPieces({...baseInput,quantity:2.3,parts:[{...part('L02',2.3,'51',{D:known51.D,J:known51.J,K:known51.K,L:known51.L,H:H51}),billingMode:'computed'}]}),/différente/);
assert.throws(()=>buildPieces({...baseInput,quantity:known51.W,parts:[{...part('L02',known51.W,'51',{D:known51.D,J:known51.J,K:known51.K,L:known51.L,H:H51}),billingMode:'manual'}]}),/automatique/);
assert.ok(Math.abs(automaticBilledLength('51',{D:known51.D,J:known51.J,K:known51.K,L:known51.L,H:H51})-known51.W)<1e-9);
assert.throws(()=>geometryPointes('51',{D:known51.D,J:known51.J,K:known51.K,L:known51.L,H:0.01}),/45°|incompatibles/);
assert.throws(()=>geometryPointes('51',{D:known51.D,J:known51.J,K:known51.K,L:known51.L*1.03,H:H51}),/45°/);
console.log('PASS: 41/51 45° obligatoires, H totale, W calculé, rejet des cotes incompatibles');
// Échantillon déterministe de 100 profils à 45° ; le moindre décalage marqué est refusé.
for(const code of ['41','51']){
 for(let i=0;i<50;i++){
  const J=.5+(i%10)*.07, D=code==='51'?.4+(i%9)*.05:0;
  const W=Math.max(D,J)+.25+(i%7)*.10;
  const K=(W-D)/Math.SQRT2,L=(W-J)/Math.SQRT2,H=W-(D+J)/2;
  const g=geometryPointes(code,{D,J,K,L,H});
  assert.ok(Math.abs(g.distancePointesM-W)<1e-9,`${code}, sample ${i}`);
  assert.ok(Math.abs(g.hauteurCalculeeM-H)<1e-9);
  assert.equal(g.angleKDeg,45);assert.equal(g.angleLDeg,45);
  assert.ok(g.wasteAreaM2>=0);
  assert.throws(()=>geometryPointes(code,{D,J,K:K+.03,L,H}),/45°/);
 }
}
console.log('PASS: 100 géométries symétriques reconstruites à 45° et 100 cotes non conformes bloquées');
