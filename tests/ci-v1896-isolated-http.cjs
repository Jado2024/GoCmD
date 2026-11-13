#!/usr/bin/env node
/* GoCmd V18.9.9 security gates on a disposable SQLite copy and localhost ONLY.
 * Never points to an operational database or remote host. CI runs this after next build.
 *
 * V18.9.9 (QA-CI-01) : la matrice de rôles est vérifiée individuellement et
 * sans contradiction — le commercial LIT le répertoire clients et les
 * commandes (données de travail, contrôlées serveur), les rôles opérationnels
 * (réception, magasin, qualité) n'y ont pas accès. Ce test échoue
 * volontairement si une permission interdite est introduite.
 * V18.9.9 (SEC-PROD-01/02) : propositions spéciales — accès par statut,
 * énumération d'identifiants et DTO interne par permission.
 * V18.9.9 (SEC-LEGACY-01) : le compte partagé reste lecture seule et sans
 * rôle, MÊME avec l'ancien drapeau de compatibilité (pire cas).
 */
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createAccounts,loginAccounts}=require('./qa-managed-accounts.cjs');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');

function freshDB(tag){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),`gocmd-v1899-http-${tag}-`));
 const testDB=path.join(dir,'ci-isolated.db');
 fs.copyFileSync(path.join(root,'db','custom.db'),testDB);
 fs.chmodSync(testDB,0o644);
 return {dir,testDB};
}
function freePort(){return new Promise((resolve,reject)=>{const srv=net.createServer();srv.on('error',reject);srv.listen(0,'127.0.0.1',()=>{const port=srv.address().port;srv.close(()=>resolve(port))})})}
function sensitivePaths(o,p='$'){
 if(Array.isArray(o))return o.flatMap((x,i)=>sensitivePaths(x,`${p}[${i}]`));
 if(!o || typeof o!=='object')return [];
 const out=[];
 for(const [k,v] of Object.entries(o)){
  if(['unitPrice','averageCost','totalAmount','freightAmount','amountCents','taxAmount','paymentTerms','creditAllocations','creditNote'].includes(k) && v!=null && !(k==='creditAllocations' && Array.isArray(v) && v.length===0))out.push(`${p}.${k}`);
  if(['phone','email','address'].includes(k) && v!==null && v!==undefined)out.push(`${p}.${k}`);
  out.push(...sensitivePaths(v,`${p}.${k}`));
 }
 return out;
}
// V18.9.9 (SEC-PROD-01) : métadonnées internes d'approbation tarifaire.
const PRODUCT_INTERNAL_KEYS=['specialNotes','specialApprovedUnitPrice','specialPriceProposedBy','specialPriceApprovedBy','specialPriceApprovedAt','specialPriceDecisionReason'];
function productInternalLeaks(o,p='$'){
 if(Array.isArray(o))return o.flatMap((x,i)=>productInternalLeaks(x,`${p}[${i}]`));
 if(!o || typeof o!=='object')return [];
 const out=[];
 for(const [k,v] of Object.entries(o)){
  if(PRODUCT_INTERNAL_KEYS.includes(k) && v!==null && v!==undefined)out.push(`${p}.${k}`);
  out.push(...productInternalLeaks(v,`${p}.${k}`));
 }
 return out;
}
async function startServer(env){
 const port=await freePort();const origin=`http://127.0.0.1:${port}`;
 // R13.2 : le lanceur contrôlé force GOCMD_REQUIRE_SQLITE_USERS=1 (fail-closed,
 // P5.15.23). Le scénario B teste précisément le mode de compatibilité legacy
 // (mot de passe partagé, GOCMD_REQUIRE_SQLITE_USERS=0) : il démarre
 // next start directement sur la copie jetable locale, exactement comme
 // audit-api-matrix.cjs — le lanceur vérifié refuse ce mode par conception.
 const legacy=env.GOCMD_REQUIRE_SQLITE_USERS==='0';
 const command=legacy
  ?[require.resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)]
  :['scripts/start-gocmd-checked.cjs'];
 const server=spawn(process.execPath,command,{
  cwd:root, env:{...process.env,GOCMD_PUBLIC_ORIGIN:origin,HOSTNAME:'127.0.0.1',PORT:String(port),NODE_ENV:'production',...(legacy?{DATABASE_URL:'file:'+env.GOCMD_DB_FILE}:{}),...env},
  detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']
 });
 let output='';for(const k of ['stdout','stderr'])server[k].on('data',x=>{output+=x.toString().slice(0,1600)});
 const abort=()=>{if(server.exitCode!==null)return;
  try{if(process.platform!=='win32')process.kill(-server.pid,'SIGTERM');else server.kill('SIGTERM');}
  catch{try{server.kill('SIGTERM')}catch{}}
 };
 let ready=false;
 for(let i=0;i<140;i++){
  if(server.exitCode!==null)throw Error(`Server exited ${server.exitCode}: ${output.slice(-2000)}`);
  try{const r=await fetch(`${origin}/api/me`,{signal:AbortSignal.timeout(1200)});if(r.status===401){ready=true;break}}catch{}
  await new Promise(r=>setTimeout(r,350));
 }
 if(!ready){abort();throw new Error('Local production Next.js server not ready; '+output.slice(-1000))}
 return {server,abort,origin,output};
}

async function scenarioNamedAccounts(){
 const {dir,testDB}=freshDB('roles');
 const roles=['buyer','approver','finance','receiver','quality','inventory','sales','sales2','director','admin','chief'];
 const accounts=createAccounts(testDB,'ci',Object.fromEntries(roles.map(role=>[
  role,role==='chief'?['buyer','approver']:[role.replace(/\d+$/,'')],
 ])));
 const {abort,origin}=await startServer({GOCMD_DB_FILE:testDB,GOCMD_REQUIRE_SQLITE_USERS:'1',
  GOCMD_REQUIRE_RBAC:'1',GOCMD_ACCESS_PASSWORD:'',
  // R13.2 (P2-01 suite) : copie jetable de la base DEMO embarquée — recette
  // locale uniquement ; HOSTNAME reste forcé à 127.0.0.1 par startServer.
  GOCMD_ALLOW_DEMO_DB:'1'});
 try{
  const cookies=await loginAccounts(origin,accounts);
  const request=async (role,method,url,body)=>{
   const r=await fetch(origin+url,{method,headers:{cookie:cookies[role],origin,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(9000)});
   return {status:r.status,data:await r.json().catch(()=>null)};
  };
  const get=(role,url)=>request(role,'GET',url);
  const post=(role,url,body)=>request(role,'POST',url,body);
  const patch=(role,url,body)=>request(role,'PATCH',url,body);

  // --- P5.15.8 : la base livrée est vierge d'historique P2P ; la matrice
  // exige des offres, BR tarifées et DA à venir. Création via l'API réelle
  // (chaîne moderne complète : DA → consultation → devis+PDF → attribution
  // quatre yeux par chief → BC → BR), sans jamais écrire en base directement.
  {
   const supplies=(await get('buyer','/api/suppliers')).data.items;
   const supplier=supplies.find(s=>s.active&&s.materials?.length);
   assert(supplier,'privacy setup: need a referenced supplier');
   const link=supplier.materials.find(l=>l.unitsPerPurchase>0);assert(link,'privacy setup: need a material link');
   const material=link.material;const price=Math.max(0.01,Number(link.unitPrice)||1);
   const token=`PRIV-${Date.now()}`;
   const q=await post('approver','/api/p2p/sourcing',{action:'qualify',supplierId:supplier.id,status:'approved',score:95,note:`Qualification privacy ${token}`});
   assert(q.status===201||q.status===200,'privacy setup: qualify');
   const da=(await post('buyer','/api/purchases',{note:`Privacy ${token}`,lines:[{materialId:material.id,qty:7}]})).data.purchase;
   assert(da?.id,'privacy setup: DA');
   assert((await patch('approver',`/api/purchases/${da.id}`,{action:'advance'})).status===200,'privacy setup: DA approved');
   const cons=(await post('buyer','/api/p2p/consultations',{lines:[{requestLineId:da.lines[0].id,qty:7}],supplierIds:[supplier.id]})).data.consultation;
   assert(cons?.id,'privacy setup: consultation');
   const rfq=(await get('buyer','/api/p2p/sourcing?pageSize=150')).data.rfqs.find(r=>r.requestLineId===da.lines[0].id&&r.status==='open');
   assert(rfq,'privacy setup: RFQ');
   const offer=(await post('buyer','/api/p2p/sourcing',{action:'offer',rfqId:rfq.id,supplierId:supplier.id,unitPrice:price,priceBasis:'STOCK',qty:7,leadTimeDays:5,quoteRef:`DEV-${token}`,validUntil:new Date(Date.now()+30*864e5).toISOString().slice(0,10)})).data.result;
   assert(offer?.id,'privacy setup: offer');
   const form=new FormData();
   form.set('offerId',String(offer.id));
   form.set('file',new Blob(['%PDF-1.4 privacy'],{type:'application/pdf'}),`dev-${token}.pdf`);
   const up=await fetch(origin+'/api/p2p/offer-documents',{method:'POST',headers:{cookie:cookies.buyer,origin},body:form});
   assert(up.status===201,'privacy setup: offer PDF');
   const proposal=await post('buyer','/api/p2p/awards',{
    action:'propose',rfqId:rfq.id,reason:'Comparaison documentée des offres de recette',
    allocations:[{offerId:offer.id,qty:7}],
   });
   assert.equal(proposal.status,201,'privacy setup: award proposal');
   const planId=proposal.data.result.planId;
   const award=await post('chief','/api/p2p/awards',{action:'approve',planId});
   assert.equal(award.status,201,'privacy setup: award (quatre yeux)');
   const creation=await post('buyer','/api/p2p/awards',{action:'createDraftOrders',planId});
   assert.equal(creation.status,201,'privacy setup: draft order');
   const [bc]=creation.data.result.orders;
   assert(bc?.id,'privacy setup: BC');
   assert((await patch('approver',`/api/supplier-orders/${bc.id}`,{action:'approve'})).status===200,'privacy setup: BC approved');
   const bcLines=(await get('buyer','/api/supplier-orders')).data.items.find(o=>o.id===bc.id).lines;
   const br=await post('receiver','/api/goods-receipts',{supplierOrderId:bc.id,deliveryRef:`BL-${token}`,lines:[{supplierOrderLineId:bcLines[0].id,acceptedQty:7,rejectedQty:0,lot:token}]});
   assert(br.status===201,'privacy setup: BR');
  }

  // Peupler la vente via l'API pour que les assertions DTO ne passent jamais à vide.
  const {client}= (await post('sales','/api/clients',{name:'Client fictif confidentialité',city:'Casablanca'})).data;
  const product=(await get('sales','/api/products?family=MATELAS')).data.items.find(p=>p.status==='active'&&p.unit==='u');
  assert(client?.id && product?.id,'privacy setup: synthetic customer and active mattress');
  const order=await post('sales','/api/orders',{
   clientId:client.id,priority:'normale',dueDate:new Date(Date.now()+7*864e5).toISOString(),
   note:'Confidentialité de recette',
   // R13.2 : prix catalogue du produit — un prix différent déclencherait le
   // visa directeur (priceApprovalStatus=pending) et bloquerait l'approbation
   // quatre yeux ; le circuit tarifaire spécial est couvert par les tests
   // dédiés (http-v1899-business-recipe, c4-r2-prices-permission).
   lines:[{productId:product.id,qty:1,unitPrice:Number(product.unitPrice)}],
  });
  assert.equal(order.status,201,'privacy setup: customer order');
  // R13.2 : une commande naît « pending_validation » (quatre yeux) et
  // n'entre dans dashboard.upcoming (new/production/ready) qu'après
  // approbation par un tiers. Sans cette étape, les assertions DTO de
  // confidentialité passaient sur une liste vide.
  const orderApproval=await patch('approver',`/api/orders/${order.data.order.id}`,{action:'approve',comment:'Fixture recette confidentialité dashboard'});
  assert.equal(orderApproval.status,200,'privacy setup: customer order approved (upcoming non vide)');

  // --- Rôles opérationnels : approvisionnement sans coûts, aucune donnée client.
  for(const role of ['receiver','inventory','quality']){
   for(const url of ['/api/goods-receipts','/api/supplier-returns','/api/suppliers','/api/supplier-orders']){
    const r=await get(role,url);assert.equal(r.status,200,`${role} ${url} read`);
    const leaks=sensitivePaths(r.data);
    assert.deepEqual(leaks,[],`${role} ${url} leaked ${leaks.join(', ')}`);
   }
   const sourcing=await get(role,'/api/p2p/sourcing');assert.equal(sourcing.status,403,`${role} must not see supplier quotes`);
   const dashboard=await get(role,'/api/dashboard');assert.equal(dashboard.status,200);
   assert.equal(dashboard.data.kpi.stockValue,null,`${role} sees total inventory value`);
   assert.deepEqual(dashboard.data.byCategory,[],`${role} sees valued categories`);
   assert.deepEqual(dashboard.data.flow,[],`${role} sees valued stock flows`);
   assert(dashboard.data.upcoming.length>0 && dashboard.data.upcoming.every(o=>o.note===null&&o.client===null&&o.total===null),`${role} sees clients or order details`);
   // QA-CI-01 : chaque rôle interdit est vérifié individuellement.
   const clients=await get(role,'/api/clients');assert.equal(clients.status,403,`${role} reads /api/clients`);
   const orders=await get(role,'/api/orders');assert.equal(orders.status,403,`${role} reads /api/orders`);
   const salesApi=await get(role,'/api/sales?type=quotes');assert.equal(salesApi.status,403,`${role} reads /api/sales`);
   const inv=await get(role,'/api/supplier-invoices');assert.equal(inv.status,403,`${role} reads supplier invoices`);
   const fin=await get(role,'/api/p2p/finance');assert.equal(fin.status,403,`${role} reads p2p finance`);
   const exp=await get(role,'/api/p2p/accounting-export');assert.equal(exp.status,403,`${role} reads accounting export`);
   // SEC-PROD-01 : catalogue sans métadonnées internes d'approbation.
   const products=await get(role,'/api/products?page=1');assert.equal(products.status,200,`${role} products`);
   const productLeaks=productInternalLeaks(products.data);
   assert.deepEqual(productLeaks,[],`${role} /api/products leaked ${productLeaks.join(', ')}`);
  }

  // --- Commercial : répertoire clients et commandes = outils de travail (200),
  // jamais les coûts d'approvisionnement ni les tarifs fournisseurs.
  for(const url of ['/api/goods-receipts','/api/supplier-returns','/api/suppliers','/api/supplier-orders']){
   const r=await get('sales',url);assert.equal(r.status,200,`sales ${url} read`);
   const leaks=sensitivePaths(r.data);
   assert.deepEqual(leaks,[],`sales ${url} leaked ${leaks.join(', ')}`);
  }
  const salesSourcing=await get('sales','/api/p2p/sourcing');assert.equal(salesSourcing.status,403,'sales must not see supplier quotes');
  const salesDashboard=await get('sales','/api/dashboard');assert.equal(salesDashboard.status,200);
  assert.equal(salesDashboard.data.kpi.stockValue,null,'sales sees total inventory value');
  assert.deepEqual(salesDashboard.data.byCategory,[],'sales sees valued categories');
  assert.deepEqual(salesDashboard.data.flow,[],'sales sees valued stock flows');
  assert(salesDashboard.data.upcoming.length>0 && salesDashboard.data.upcoming.every(o=>o.client!==null&&o.total!==null),'sales must see own commercial orders (QA-CI-01 corrected matrix)');
  const salesClients=await get('sales','/api/clients');assert.equal(salesClients.status,200,'sales reads /api/clients (200 expected — contradiction removed)');
  const salesOrders=await get('sales','/api/orders');assert.equal(salesOrders.status,200,'sales reads /api/orders');
  const salesLeaks=productInternalLeaks(salesOrders.data);
  assert.deepEqual(salesLeaks,[],`sales /api/orders leaked product internals ${salesLeaks.join(', ')}`);
  const salesPendingList=await get('sales','/api/products?pendingPrice=1');assert.equal(salesPendingList.status,403,'pending price list is director-only');

  // --- Rôles financiers : coûts et tarifs fournisseurs autorisés.
  for(const role of ['buyer','approver','finance']){
   const x=await get(role,'/api/p2p/sourcing');assert.equal(x.status,200,`${role} sourcing`);
   assert(x.data.rfqs.some(r=>r.offers.some(o=>o.unitPrice!=null)),`${role}: should see offer prices`);
   const receipts=await get(role,'/api/goods-receipts');assert.equal(receipts.status,200);
   const dashboard=await get(role,'/api/dashboard');assert.equal(dashboard.status,200);
   assert.equal(typeof dashboard.data.kpi.stockValue,'number',`${role} lost stock valuation permission`);
   assert(receipts.data.items.length>0 && receipts.data.items.some(r=>r.lines.some(l=>l.supplierOrderLine.unitPrice!=null)),`${role} still sees permitted BC line prices`);
  }
  const directorOrders=await get('director','/api/orders');assert.equal(directorOrders.status,200,'director reads orders');
  const adminProducts=await get('admin','/api/products?page=1');assert.equal(adminProducts.status,403,'a pure admin has no operational access');
  const anon=await fetch(origin+'/api/p2p/sourcing');assert.equal(anon.status,401);
  // Inventaire des méthodes exportées par les routes Next. Chaque appel vise le
  // serveur de recette sans cookie et avec une origine locale valide.
  const apiRoot=path.join(root,'src','app','api');
  for (const relative of fs.readdirSync(apiRoot,{recursive:true}).map(String).sort()) {
   if(path.basename(relative)!=='route.ts') continue;
   const url='/api/'+path.dirname(relative).split(path.sep).join('/').replace(/\[[^\]]+\]/g,'1');
   const source=fs.readFileSync(path.join(apiRoot,relative),'utf8');
   for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|DELETE|PUT)\s*\(/g)) {
    const method=match[1];
    const publicLogout=url==='/api/auth/logout';
    const response=await fetch(origin+url,{method,redirect:'manual',
     headers:{origin,'content-type':'application/json'},
     body:method==='GET'?undefined:'{}',signal:AbortSignal.timeout(9000)});
    console.log('ANON_ROUTE '+JSON.stringify({method,url,status:response.status,source:relative}));
    assert.equal(response.status,publicLogout?200:401,method+' '+url+' sans session');
   }
  }
  const forged=await fetch(origin+'/api/clients',{method:'POST',
   headers:{cookie:cookies.sales,origin:'https://intrus.invalid','content-type':'application/json'},
   body:JSON.stringify({name:'Client intrus de recette',city:'Casablanca'})});
  assert.equal(forged.status,403,'Origine croisée interdite même avec session active');


  // --- SEC-PROD-02 : proposition spéciale — création par le commercial.
  const created=await post('sales','/api/products',{
   model:'CI SALON TEST',family:'SALON',length:220,width:90,height:80,
   unitPrice:1234.50,subCategory:'Sur mesure',
   specialNotes:'Proposition de test CI V18.9.9 — salon spécifique client'
  });
  assert.equal(created.status,201,'special product creation by sales');
  const pid=created.data.product.id;
  assert.equal(created.data.product.status,'pending_validation');
  assert.equal(created.data.product.specialPriceStatus,'pending');
  assert.equal(created.data.product.specialNotes,'Proposition de test CI V18.9.9 — salon spécifique client','proposer sees own notes');

  // Le directeur voit la file des prix à décider.
  const queue=await get('director','/api/products?pendingPrice=1');
  assert.equal(queue.status,200);
  assert(queue.data.items.some(p=>p.id===pid),'director pending price queue must list the proposal');

  // Énumération d'identifiants : rôles non concernés → 404 (pas 403 : ne pas
  // confirmer l'existence d'une proposition confidentielle).
  for(const role of ['receiver','quality','inventory','buyer','approver','finance']){
   const r=await get(role,`/api/products/${pid}`);
   assert.equal(r.status,404,`${role} must not read a pending special proposal (got ${r.status})`);
  }
  const otherSales=await get('sales2',`/api/products/${pid}`);
  assert.equal(otherSales.status,404,'another sales must not read a pending proposal of a colleague');
  // Le commercial concerné et le directeur conservent l'accès.
  const proposerView=await get('sales',`/api/products/${pid}`);
  assert.equal(proposerView.status,200,'proposer reads own proposal');
  assert.equal(proposerView.data.specialNotes,'Proposition de test CI V18.9.9 — salon spécifique client');
  const directorView=await get('director',`/api/products/${pid}`);
  assert.equal(directorView.status,200,'director reads proposal');
  assert.equal(directorView.data.specialPriceProposedBy,'ci_sales','director sees proposer identity');

  // La liste catalogue ne montre pas la proposition en attente aux autres rôles.
  const listReceiver=await get('receiver','/api/products?page=1&family=SALON');
  assert(!listReceiver.data.items.some(p=>p.id===pid),'receiver list must not include pending proposal');
  const listSales2=await get('sales2','/api/products?page=1&family=SALON');
  assert(!listSales2.data.items.some(p=>p.id===pid),'other sales list must not include pending proposal');

  // --- Visa directeur : prix différent de la proposition.
  const decision=await post('director',`/api/products/${pid}/director-price`,{action:'approve',unitPrice:1300.75,reason:'Visa CI V18.9.9 conforme à la politique tarifaire',sensitivePassword:accounts.director.password});
  assert.equal(decision.status,200,`director approves price (got ${JSON.stringify(decision.data).slice(0,200)})`);
  assert.equal(decision.data.product.specialPriceStatus,'approved');
  assert.equal(decision.data.product.specialApprovedUnitPrice,1300.75);
  assert.equal(decision.data.product.unitPrice,1300.75,'authorized price becomes the sale price');

  // Un autre commercial voit la référence visée (réutilisable en commande),
  // mais avec les métadonnées internes MASQUÉES (SEC-PROD-01).
  const otherSalesAfter=await get('sales2',`/api/products/${pid}`);
  assert.equal(otherSalesAfter.status,200,'approved-price proposal reusable by other sales');
  assert.equal(otherSalesAfter.data.specialPriceStatus,'approved','status stays visible for commercial work');
  assert.equal(otherSalesAfter.data.unitPrice,1300.75,'authorized sale price stays visible');
  const maskedLeaks=productInternalLeaks(otherSalesAfter.data);
  assert.deepEqual(maskedLeaks,[],`other sales sees internal approval metadata: ${maskedLeaks.join(', ')}`);
  // Les rôles opérationnels ne voient toujours pas la référence non active.
  const receiverAfter=await get('receiver',`/api/products/${pid}`);
  assert.equal(receiverAfter.status,404,'receiver must not read non-active special product even after price approval');
  // Le proposant et le directeur gardent les métadonnées complètes.
  const proposerAfter=await get('sales',`/api/products/${pid}`);
  assert.equal(proposerAfter.data.specialPriceApprovedBy,'ci_director','proposer sees approval trace');
  const listSales2After=await get('sales2','/api/products?page=1&family=SALON');
  assert(listSales2After.data.items.some(p=>p.id===pid),'approved-price proposal appears in sales list');
  const listLeaks=productInternalLeaks(listSales2After.data);
  assert.deepEqual(listLeaks,[],`sales list leaks internal metadata: ${listLeaks.join(', ')}`);
  // Refus attendu : un approbateur ordinaire ne peut PAS décider du prix.
  const approverTry=await post('approver',`/api/products/${pid}/director-price`,{action:'approve',unitPrice:1,reason:'tentative interdite approver'});
  assert.equal(approverTry.status,403,'approver must not approve special prices');
  const adminTry=await post('admin',`/api/products/${pid}/director-price`,{action:'approve',unitPrice:1,reason:'tentative interdite admin'});
  assert.equal(adminTry.status,403,'admin must not replace the director on prices');

  console.log('PASS V18.9.9 scenario A — matrice rôles sans contradiction, confidentialité produits spéciaux, visa directeur vérifié');
 }finally{abort();try{fs.rmSync(dir,{recursive:true,force:true})}catch{}}
}

async function scenarioLegacySharedAccount(){
 // Pire cas : drapeau de compatibilité ancien actif, RBAC non exigé.
 const {dir,testDB}=freshDB('legacy');
 // Simuler une installation historique sans comptes SQLite, uniquement sur la copie.
 const legacyDB=new DatabaseSync(testDB);
 try { legacyDB.exec('DELETE FROM GoCmdSession; DELETE FROM GoCmdUser'); }
 finally { legacyDB.close(); }
 const shared=randomBytes(24).toString('base64url');
 const {abort,origin}=await startServer({GOCMD_DB_FILE:testDB,GOCMD_USERS_JSON:'',
  GOCMD_ACCESS_PASSWORD:shared,GOCMD_ALLOW_LEGACY_WRITES:'1',GOCMD_REQUIRE_RBAC:'0',GOCMD_REQUIRE_SQLITE_USERS:'0',
  // R13.2 (P2-01 suite) : même raison — copie jetable locale de la base DEMO.
  GOCMD_ALLOW_DEMO_DB:'1'});
 try{
  const auth='Basic '+Buffer.from(`gocmd:${shared}`).toString('base64');
  const get=async url=>{const r=await fetch(origin+url,{headers:{Authorization:auth},signal:AbortSignal.timeout(9000)});let data;try{data=await r.json()}catch{data=null}return {status:r.status,data}};
  const post=async (url,body)=>{const r=await fetch(origin+url,{method:'POST',headers:{Authorization:auth,origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(9000)});let data;try{data=await r.json()}catch{data=null}return {status:r.status,data}};
  // Lectures opérationnelles autorisées, sans données nominatives ni financières.
  const dash=await get('/api/dashboard');assert.equal(dash.status,200,'legacy dashboard read');
  assert.equal(dash.data.kpi.stockValue,null,'legacy sees stock value');
  assert(dash.data.upcoming.every(o=>o.note===null&&o.client===null&&o.total===null),'legacy sees client data on dashboard');
  const mats=await get('/api/materials');assert.equal(mats.status,200,'legacy materials read');
  assert(mats.data.items.every(m=>m.unitPrice===null&&m.averageCost===null),'legacy sees material costs');
  const prods=await get('/api/products?page=1');assert.equal(prods.status,200,'legacy products read');
  const prodLeaks=productInternalLeaks(prods.data);
  assert.deepEqual(prodLeaks,[],`legacy products leak internals: ${prodLeaks.join(', ')}`);
  const receipts=await get('/api/goods-receipts');assert.equal(receipts.status,200);
  const receiptLeaks=sensitivePaths(receipts.data);
  assert.deepEqual(receiptLeaks,[],`legacy goods-receipts leaked ${receiptLeaks.join(', ')}`);
  // Aucune donnée financière, client, facture ou export.
  for(const url of ['/api/clients','/api/orders','/api/sales?type=quotes','/api/sales?type=invoices','/api/supplier-invoices','/api/p2p/sourcing','/api/p2p/finance','/api/p2p/accounting-export','/api/products?pendingPrice=1']){
   const r=await get(url);assert.equal(r.status,403,`legacy must not read ${url} (got ${r.status})`);
  }
  // Aucune écriture métier, même avec l'ancien drapeau de compatibilité.
  for(const [url,body] of [['/api/clients',{name:'Client Pirate',city:'Ville'}],['/api/orders',{clientId:1,dueDate:'2027-01-01T00:00:00Z',lines:[]}],['/api/movements',{type:'out',materialId:1,qty:1,reason:'écriture interdite'}],['/api/quality-inspections',{stockLotId:1,qty:1,decision:'release',reason:'contournement interdit'}]]){
   const r=await post(url,body);assert.equal(r.status,403,`legacy must not write ${url} (got ${r.status})`);
  }
  const patch=await fetch(origin+'/api/products/1',{method:'PATCH',headers:{Authorization:auth,origin,'content-type':'application/json'},body:JSON.stringify({unitPrice:1,reason:'patch interdit'})});
  assert.equal(patch.status,403,'legacy must not PATCH products');
  console.log('PASS V18.9.9 scenario B — compte partagé : lecture seule, aucun rôle, aucun accès financier/nominatif, même avec GOCMD_ALLOW_LEGACY_WRITES=1');
 }finally{abort();try{fs.rmSync(dir,{recursive:true,force:true})}catch{}}
}

(async()=>{
 await scenarioNamedAccounts();
 await scenarioLegacySharedAccount();
 console.log('PASS V18.9.9 — portes HTTP sécurité complètes sur serveur de production local isolé');
})().catch(e=>{console.error('FAIL V18.9.9 HTTP:',e.stack||e);process.exitCode=1});
