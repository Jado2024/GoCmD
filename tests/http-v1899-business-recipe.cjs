#!/usr/bin/env node
/* Recette HTTP métier V18.9.9 — serveur de production local isolé, base
 * SQLite jetable, comptes nominatifs distincts. NEVER run on operational data.
 * Scénarios couverts (complément des recettes P2P/ventes existantes) :
 *  R1  création fournisseur + association à plusieurs matières ;
 *  R7  salon 8,8 ml × 235 MAD = 2 068 MAD (pièces L01/L02 × 2 ensembles) ;
 *  R8  gabarit Richbond 11 : longueur facturée = D ;
 *  R9  produit spécial : proposition commerciale → visa directeur → commande
 *      au prix exactement autorisé ;
 *  R10 refus de décision tarifaire par commercial, approbateur et admin ;
 *  R11 modification de prix après visa : révocation, commande à l'ancien
 *      prix refusée, nouvelle proposition soumise au directeur.
 */
const assert=require('node:assert/strict');
const {createAccounts,loginAccounts}=require('./qa-managed-accounts.cjs');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gocmd-v1899-recette-'));
const testDB=path.join(dir,'recette.db');
fs.copyFileSync(path.join(root,'db','custom.db'),testDB);

const roles=['buyer','sales','director','approver','admin'];
const accounts=createAccounts(testDB,'rc',Object.fromEntries(roles.map(role=>[role,[role]])));
let cookies;
function freePort(){return new Promise((resolve,reject)=>{const srv=net.createServer();srv.on('error',reject);srv.listen(0,'127.0.0.1',()=>{const port=srv.address().port;srv.close(()=>resolve(port))})})}
let n=0;const journal=[];
async function call(role,method,apiPath,body,allowed=[200,201]){
 const r=await fetch(origin+apiPath,{method,headers:{cookie:cookies[role],origin,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 let data;try{data=await r.json()}catch{data=null}
 n++;journal.push(`${method} ${apiPath} => ${r.status}`);
 if(!allowed.includes(r.status))throw new Error(`${method} ${apiPath} ${r.status}: ${JSON.stringify(data).slice(0,700)}`);
 return {status:r.status,data};
}
let origin;
async function run(){
 const port=await freePort();origin=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,['scripts/start-gocmd-checked.cjs'],{
  cwd:root,env:{...process.env,GOCMD_DB_FILE:testDB,GOCMD_REQUIRE_SQLITE_USERS:'1',GOCMD_ALLOW_DEMO_DB:'1',
   GOCMD_REQUIRE_RBAC:'1',GOCMD_ACCESS_PASSWORD:'',
   GOCMD_PUBLIC_ORIGIN:origin,HOSTNAME:'127.0.0.1',PORT:String(port),NODE_ENV:'production'},
  detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
 let output='';for(const k of ['stdout','stderr'])server[k].on('data',x=>{output+=x.toString().slice(0,1600)});
 const abort=()=>{if(server.exitCode!==null)return;try{if(process.platform!=='win32')process.kill(-server.pid,'SIGTERM');else server.kill('SIGTERM')}catch{try{server.kill('SIGTERM')}catch{}}};
 try{
  let ready=false;
  for(let i=0;i<140;i++){
   if(server.exitCode!==null)throw Error(`Server exited ${server.exitCode}: ${output.slice(-2000)}`);
   try{const r=await fetch(`${origin}/api/me`,{signal:AbortSignal.timeout(1200)});if(r.status===401){ready=true;break}}catch{}
   await new Promise(r=>setTimeout(r,350));
  }
  assert(ready,'Serveur local non prêt');
  cookies=await loginAccounts(origin,accounts);

  // ---- R1 : création fournisseur + association à deux matières.
  const supplier=(await call('buyer','POST','/api/suppliers',{name:'RECETTE FOURNISSEUR V1899',phone:'0500000000'})).data.supplier;
  assert(supplier.id&&supplier.code.startsWith('FRN-'),'code fournisseur serveur');
  const materials=(await call('buyer','GET','/api/materials')).data.items;
  const mat1=materials[0],mat2=materials[1];
  await call('buyer','POST','/api/suppliers',{action:'link',supplierId:supplier.id,materialId:mat1.id,unitPrice:12.5,unitsPerPurchase:1});
  await call('buyer','POST','/api/suppliers',{action:'link',supplierId:supplier.id,materialId:mat2.id,unitPrice:7.25,unitsPerPurchase:1});
  const afterLink=(await call('buyer','GET','/api/suppliers')).data.items.find(s=>s.id===supplier.id);
  assert.equal(afterLink.materials.length,2,'fournisseur associé à deux matières');
  assert(afterLink.materials.every(l=>l.unitPrice!=null),'buyer voit les prix de ses associations');

  // ---- R7 : salon 8,8 ml × 235 MAD = 2 068 MAD.
  const salon=(await call('sales','GET','/api/products?family=SALON')).data.items.find(p=>p.status==='active'&&p.unit==='ml');
  assert(salon,'produit salon actif en ml requis');
  const client=(await call('sales','GET','/api/clients')).data.items[0];
  const partsStd=[
   {label:'Salon recette L01',partRef:'L01',linearMeters:2.6,count:1,gabaritCode:'STD',billingMode:'manual',shape:'rectangle',lengthCm:salon.length,widthCm:salon.width,heightCm:salon.height},
   {label:'Salon recette L02',partRef:'L02',linearMeters:1.8,count:1,gabaritCode:'STD',billingMode:'manual',shape:'rectangle',lengthCm:salon.length,widthCm:salon.width,heightCm:salon.height},
  ];
  const salonOrder=(await call('sales','POST','/api/orders',{clientId:client.id,dueDate:new Date(Date.now()+10*86400_000).toISOString(),priority:'normale',note:'RECETTE R7 salon 8,8ml',lines:[{productId:salon.id,qty:8.8,unitPrice:235,ensembleCount:2,parts:partsStd}]})).data.order;
  assert.equal(salonOrder.lines[0].pieces.length,4,'4 pièces L01/L02 × 2 ensembles');
  const totalMl=salonOrder.lines[0].pieces.reduce((s,p)=>s+p.linearMeters,0);
  assert(Math.abs(totalMl-8.8)<1e-9,`métrage cumulé 8,8 ml (obtenu ${totalMl})`);
  const total=salonOrder.lines.reduce((t,l)=>t+l.qty*l.unitPrice,0);
  assert(Math.abs(total-2068)<1e-9,`total 8,8 × 235 = 2068 MAD (obtenu ${total})`);

  // ---- R8 : gabarit 11 — longueur facturée D.
  const banquettes=(await call('sales','GET','/api/products?family=BANQUETTE')).data.items.filter(p=>p.status==='active'&&p.unit==='ml');
  const banquette=banquettes[0];
  assert(banquette,'produit banquette actif en ml requis');
  const D=2.4,J=0.95;
  const part11={label:'Banquette pente droite',partRef:'L11',count:2,gabaritCode:'11',billingMode:'computed',shape:'gabarit',lengthCm:banquette.length,widthCm:banquette.width,heightCm:banquette.height,extra:{D,J}};
  const g11Order=(await call('sales','POST','/api/orders',{clientId:client.id,dueDate:new Date(Date.now()+10*86400_000).toISOString(),priority:'normale',note:'RECETTE R8 gabarit 11',lines:[{productId:banquette.id,qty:D*2,unitPrice:300,parts:[part11]}]})).data.order;
  const g11Pieces=g11Order.lines[0].pieces;
  assert.equal(g11Pieces.length,2,'deux pièces gabarit 11');
  assert(g11Pieces.every(p=>Math.abs(p.linearMeters-D)<1e-9),`gabarit 11 : chaque pièce facturée D=${D} m`);
  assert.equal(g11Pieces[0].gabaritCode,'11');
  assert.equal(g11Pieces[0].billingMode,'computed');

  // ---- R9 : produit spécial — visa directeur obligatoire.
  const special=(await call('sales','POST','/api/products',{model:'RECETTE SALON SPECIAL',family:'SALON',length:210,width:85,height:75,unitPrice:999,subCategory:'Sur mesure',specialNotes:'Recette V18.9.9 : salon spécifique avec contrainte de dimension'})).data.product;
  assert.equal(special.status,'pending_validation');
  assert.equal(special.specialPriceStatus,'pending');
  // Commande au prix PROPOSÉ interdite avant visa pour le devis définitif… la
  // commande provisoire reste possible au prix proposé (statut pending_validation),
  // mais la production reste bloquée ; le devis, lui, exige le visa :
  // Audit 10/11/2026 (DEF-R9) : la recette échouait sur l'archive livrée
  // elle-même. Deux causes :
  //  1. la ligne du devis était incomplète (pas de pièces) → refus 400 des
  //     gabarits AVANT le contrôle tarifaire ;
  //  2. l'attente était un refus à la CRÉATION du brouillon, alors que le
  //     contrôle réel du prix spécial se joue à l'ENVOI du devis au client
  //     (quote-state « sent » → DIRECTOR_PRICE_REQUIRED tant que le visa
  //     directeur manque) — un brouillon interne au prix proposé reste permis.
  // Un brouillon de devis ne pouvant pas être annulé et bloquant toute
  // re-proposition tarifaire, la garde s'exerce sur une RÉFÉRENCE SPÉCIALE
  // DÉDIÉE, sans toucher au produit `special` utilisé par R10/R11.
  const special2=(await call('sales','POST','/api/products',{model:'RECETTE SALON SPECIAL DEVIS',family:'SALON',length:210,width:85,height:75,unitPrice:888,subCategory:'Sur mesure',specialNotes:'Recette V18.9.9 : garde devis sur référence dédiée'})).data.product;
  const quoteDraft=await call('sales','POST','/api/sales',{action:'quote',payload:{clientId:client.id,dueDate:new Date(Date.now()+10*86400_000).toISOString(),priority:'normale',lines:[{productId:special2.id,qty:3.2,unitPrice:888,ensembleCount:1,parts:[{label:'Salon spécial devis',partRef:'L01',linearMeters:3.2,count:1,gabaritCode:'STD',billingMode:'manual',shape:'rectangle',lengthCm:special2.length,widthCm:special2.width,heightCm:special2.height}]}]}},[201]);
  assert.equal(quoteDraft.status,201,'brouillon de devis au prix proposé enregistré');
  const quoteTry=await call('sales','POST','/api/sales',{action:'quote-state',id:quoteDraft.data.quote.id,state:'sent'},[409]);
  assert.equal(quoteTry.status,409,'envoi du devis au client refusé sans visa directeur');

  // ---- R10 : seuls les directeurs nominatifs décident du prix.
  await call('sales','POST',`/api/products/${special.id}/director-price`,{action:'approve',unitPrice:1050,reason:'tentative interdite commercial'},[403]);
  await call('approver','POST',`/api/products/${special.id}/director-price`,{action:'approve',unitPrice:1050,reason:'tentative interdite approbateur'},[403]);
  await call('admin','POST',`/api/products/${special.id}/director-price`,{action:'approve',unitPrice:1050,reason:'tentative interdite admin'},[403]);
  // Visa réel du directeur, à un prix différent de la proposition.
  await call('director','POST',`/api/products/${special.id}/director-price`,{action:'approve',unitPrice:1300.75,reason:'Tentative sans confirmation du directeur'},[400]);
  await call('director','POST',`/api/products/${special.id}/director-price`,{action:'approve',unitPrice:1300.75,reason:'Tentative confirmation incorrecte',sensitivePassword:'wrong-password'},[403]);
  const visa=(await call('director','POST',`/api/products/${special.id}/director-price`,{action:'approve',unitPrice:1300.75,reason:'Visa recette V18.9.9 après étude',sensitivePassword:accounts.director.password})).data.product;
  assert.equal(visa.specialPriceStatus,'approved');
  assert.equal(visa.specialApprovedUnitPrice,1300.75);
  assert.equal(visa.unitPrice,1300.75,'le prix autorisé devient le prix de vente');
  // Commande au prix exactement autorisé ; prix différent refusé.
  const wrongPrice=await call('sales','POST','/api/orders',{clientId:client.id,dueDate:new Date(Date.now()+10*86400_000).toISOString(),priority:'normale',note:'RECETTE R9 prix trafiqué',lines:[{productId:special.id,qty:3.2,unitPrice:999}]},[409]);
  assert.equal(wrongPrice.status,409,'commande à un prix différent du visa refusée');
  const specialOrder=(await call('sales','POST','/api/orders',{clientId:client.id,dueDate:new Date(Date.now()+10*86400_000).toISOString(),priority:'normale',note:'RECETTE R9 prix visé',lines:[{productId:special.id,qty:3.2,unitPrice:1300.75,ensembleCount:1,parts:[{label:'Salon spécial',partRef:'L01',linearMeters:3.2,count:1,gabaritCode:'STD',billingMode:'manual',shape:'rectangle',lengthCm:special.length,widthCm:special.width,heightCm:special.height}]}]})).data.order;
  assert.equal(specialOrder.status,'pending_validation','commande avec produit provisoire en attente de validation');
  // La production reste bloquée tant que la commande n'est pas validée.
  await call('sales','PATCH',`/api/orders/${specialOrder.id}`,{action:'advance'},[409]);

  // ---- R11 : modification du prix après visa → visa révoqué.
  const repropose=(await call('sales','POST',`/api/products/${special.id}/director-price`,{action:'propose',unitPrice:1350,reason:'Augmentation matière recette V18.9.9'})).data.product;
  assert.equal(repropose.specialPriceStatus,'pending','le visa est révoqué par la nouvelle proposition');
  assert.equal(repropose.specialApprovedUnitPrice,null);
  const staleOrder=await call('sales','POST','/api/orders',{clientId:client.id,dueDate:new Date(Date.now()+10*86400_000).toISOString(),priority:'normale',note:'RECETTE R11 ancien prix',lines:[{productId:special.id,qty:1.5,unitPrice:1300.75}]},[409]);
  assert.equal(staleOrder.status,409,'commande à l\'ancien prix approuvé refusée après révocation');
  // Un produit provisoire ne peut être lié qu'à UNE commande : la commande
  // existante suit automatiquement la nouvelle proposition tarifaire.
  const secondOrder=await call('sales','POST','/api/orders',{clientId:client.id,dueDate:new Date(Date.now()+10*86400_000).toISOString(),priority:'normale',note:'RECETTE R11 doublon',lines:[{productId:special.id,qty:1.5,unitPrice:1350}]},[409]);
  assert.equal(secondOrder.status,409,'une référence provisoire déjà liée ne peut pas passer dans une seconde commande');
  const linkedOrders=(await call('sales','GET','/api/orders')).data.items;
  const linked=linkedOrders.find(o=>o.id===specialOrder.id);
  assert(linked,'commande liée au produit spécial');
  assert.equal(linked.lines.find(l=>l.productId===special.id).unitPrice,1350,'la commande provisoire suit la nouvelle proposition');
  // Nouveau visa du directeur, puis validation de commande par un approbateur distinct.
  const visa2=(await call('director','POST',`/api/products/${special.id}/director-price`,{action:'approve',unitPrice:1350,reason:'Second visa recette V18.9.9',sensitivePassword:accounts.director.password})).data.product;
  assert.equal(visa2.specialPriceStatus,'approved');
  const reviewed=(await call('approver','PATCH',`/api/orders/${specialOrder.id}`,{action:'approve',comment:'Recette R11 : conformité vérifiée'})).data.order;
  assert.equal(reviewed.status,'new','commande validée après visa tarifaire complet');
  assert.equal(reviewed.lines.find(l=>l.productId===special.id).unitPrice,1350,'prix visé appliqué à la commande');

  console.log(`PASS RECETTE V18.9.9 : ${n} requêtes — R1 fournisseur+2 matières, R7 salon 8,8ml=2068 MAD, R8 gabarit 11 facturé D, R9/R10/R11 visa directeur bout en bout`);
 }finally{
  abort();
  console.log('Journal de la recette :\n'+journal.join('\n'));
  try{fs.rmSync(dir,{recursive:true,force:true})}catch{}
 }
}
run().catch(e=>{console.error('FAIL RECETTE V18.9.9:',e.stack||e);process.exitCode=1});
