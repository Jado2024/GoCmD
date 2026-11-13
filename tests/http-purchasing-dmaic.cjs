'use strict';
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {copyFileSync, mkdtempSync, rmSync, writeFileSync} = require('node:fs');
const {once} = require('node:events');
const {createServer} = require('node:net');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const root = resolve(__dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'gocmd-dmaic-'));
const file = join(temp, 'recette.db');
copyFileSync(join(root, 'db', 'custom.db'), file);
process.env.GOCMD_DB_FILE = file;
const directory = require('../src/lib/user-directory.cjs');
const roles = { purebuyer:['buyer'], buyer:['buyer','approver'], approver:['approver'], receiver:['receiver'], quality:['quality'], inventory:['inventory'], inventory2:['inventory'], finance:['finance'], finance2:['finance'], finance3:['finance'], sales:['sales'], sales2:['sales'], saleschief:['sales','approver'], director:['director'] };
const users = {};
const cookies = {};
let server, base;
const checks = [];
const months = process.argv.includes("--months");
const clock = join(temp,"clock.txt");
if(months) writeFileSync(clock,"2026-11-09T09:00:00Z");

async function api(role, method, path, body, accepted = [200,201]) {
  const simulatedAt=months?require('node:fs').readFileSync(clock,'utf8').trim():null;
  const started=performance.now();
  const response = await fetch(base + path, {
    method, redirect:'manual',
    signal:AbortSignal.timeout(15000),
    headers:{origin:base, ...(cookies[role] ? {cookie:cookies[role]} : {}),
      ...(body ? {'Content-Type':'application/json'} : {})},
    body:body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  const data = response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : {};
  checks.push(`${role} ${method} ${path} ${response.status}`);
  if(months) console.log('HTTP_TRACE '+JSON.stringify({
    simulatedAt,role,method,path,status:response.status,durationMs:Math.round(performance.now()-started),
    input:['/api/auth/login','/api/me/password','/api/admin/users'].includes(path)?'Données de compte masquées':body,
    output:{id:data.id??data.result?.id,ref:data.ref,status:data.status,error:data.error,
      documents:Object.fromEntries(['purchase','consultation','order','quote','delivery','invoice','credit','client'].flatMap(key=>{
        const doc=data[key];
        return doc ? [[key,{id:doc.id,ref:doc.ref,status:doc.status,totalCents:doc.totalCents}]] : [];
      })),planId:data.result?.planId},
  }));
  assert(accepted.includes(response.status), `${checks.at(-1)} ${JSON.stringify(data).slice(0,450)}`);
  return {response,data,raw};
}

async function run() {
  const portProbe = createServer().listen(0,'127.0.0.1');
  await once(portProbe,'listening');
  const port = portProbe.address().port;
  await new Promise(done=>portProbe.close(done));
  base = `http://127.0.0.1:${port}`;
  const database = new DatabaseSync(file);
  const admin = database.prepare('SELECT username FROM GoCmdUser WHERE is_root=1').get().username;
  for (const [key, value] of Object.entries(roles)) {
    const username = `qa_${key}`;
    const initial = randomBytes(24).toString('base64url');
    const password = randomBytes(24).toString('base64url');
    directory.createUser(admin,username,initial,value,{});
    directory.changeOwnPassword(username,initial,password);
    users[key] = {username,password};
  }
  if(months) {
    const initial = randomBytes(24).toString('base64url');
    const password = randomBytes(24).toString('base64url');
    directory.updateUser(admin,admin,{password:initial});
    directory.changeOwnPassword(admin,initial,password);
    users.root={username:admin,password};
  }
  const fixture = database.prepare(`
    SELECT m.id AS materialId FROM Material m JOIN SupplierMaterial sm ON sm.materialId=m.id
    JOIN Supplier s ON s.id=sm.supplierId AND s.active=1
    WHERE m.unit='kg' AND m.isPurchasable=1 AND sm.unitsPerPurchase=1
    GROUP BY m.id HAVING COUNT(*)>=2 ORDER BY (m.stockQty>0 AND m.stockQty<m.minStock) DESC,m.id LIMIT 1
  `).get();
  assert(fixture,'Matière achetable en kg, deux fournisseurs actifs et conversion 1:1');
  const {materialId} = fixture;
  const suppliers = database.prepare(`
    SELECT sm.supplierId AS id FROM SupplierMaterial sm JOIN Supplier s ON s.id=sm.supplierId
    WHERE sm.materialId=? AND sm.unitsPerPurchase=1 AND s.active=1 ORDER BY sm.supplierId LIMIT 2
  `).all(materialId);
  const opening = database.prepare('SELECT stockQty,averageCost,unitPrice FROM Material WHERE id=?').get(materialId);
  const stock0 = opening.stockQty;
  server = spawn(process.execPath,[...(months?['--require',join(__dirname,'purchasing-qa-clock.cjs')]:[]),require.resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)],{
    cwd:root,env:{...process.env,DATABASE_URL:'file:'+file,GOCMD_QA_CLOCK_FILE:clock,GOCMD_PUBLIC_ORIGIN:base,GOCMD_DOCUMENTS_DIR:join(temp,'documents'),GOCMD_REQUIRE_SQLITE_USERS:'1',GOCMD_ALLOW_DEMO_DB:'1',
      // Contre-audit final (FA-06) : la TVA est strictement configurable depuis
      // l'arbitrage du 08/11/2026 (aucun taux implicite, facturation bloquée si
      // liste absente). La simulation six mois exerce la facturation O2C : elle
      // doit donc configurer explicitement la liste autorisée — comme le font
      // déjà sc-recette-ventes-p51521.cjs et run-e2e-playwright.cjs ('0,2000').
      // L'ancienne exécution PASS s'appuyait sur un .env local depuis retiré
      // de l'archive : sans cette ligne, l'archive extraite échoue (O2C-BILL
      // 409 « Taux de TVA absent de la configuration »).
      GOCMD_SALES_TAX_RATES_BPS:process.env.GOCMD_SALES_TAX_RATES_BPS||'0,2000',
      NODE_ENV:'production'},stdio:['ignore','pipe','pipe'],
  });
  let serverOutput='';
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{serverOutput=(serverOutput+chunk).slice(-6000)});
  for(let i=0;i<80;i++) {
    if(server.exitCode!==null) throw Error(serverOutput);
    try {if((await fetch(base+'/api/me')).status===401) break} catch {}
    assert(i<79,serverOutput);
    await new Promise(done=>setTimeout(done,250));
  }
  async function login() {
  for(const role of Object.keys(users)) {
    const {response}=await api(role,'POST','/api/auth/login',users[role]);
    cookies[role]=response.headers.get('set-cookie').split(';')[0];
  }
  }
  if(months) {
    try {
      await require('./purchasing-six-months.cjs')({api,cookies,database,temp,login,advance:date=>writeFileSync(clock,date+'T09:00:00Z')});
    } finally {database.close()}
    return;
  }
  await login();
  await api('sales','GET','/api/materials/da-followup?scope=open',null,[403]);
  for(const supplier of suppliers) await api('approver','POST','/api/p2p/sourcing',{
    action:'qualify',supplierId:supplier.id,status:'approved',score:95,note:'Qualification fictive de recette',
  });
  const {data:{purchase}}=await api('buyer','POST','/api/purchases',{note:'Recette isolée 60/40',lines:[{materialId,qty:100}]});
  const requestLineId=purchase.lines[0].id;
  await api('buyer','PATCH',`/api/purchases/${purchase.id}`,{action:'advance'},[409]);
  await api('approver','PATCH',`/api/purchases/${purchase.id}`,{action:'advance'});
  const grouped={lines:[{requestLineId,qty:100}],supplierIds:suppliers.map(s=>s.id)};
  const {data:{consultation}}=await api('buyer','POST','/api/p2p/consultations',grouped);
  await api('buyer','POST','/api/p2p/consultations',grouped,[409]);
  const {data:consults}=await api('buyer','GET','/api/p2p/consultations');
  const {rfqId}=consults.items.find(c=>c.id===consultation.id).lines[0];
  const common={rfqId,unitPrice:10,leadTimeDays:3};
  const calledAt=new Date(Date.now()-3600000).toISOString();
  const phoneInput={
    ...common,action:'oralOffer',supplierId:suppliers[0].id,qty:60,
    contactName:'Contact test',callSummary:'Prix et délai confirmés par téléphone.',calledAt,
  };
  await api('buyer','POST','/api/p2p/sourcing',{...phoneInput,calledAt:new Date(Date.now()+3600000).toISOString()},[409]);
  const {data:{result:phone}}=await api('buyer','POST','/api/p2p/sourcing',phoneInput);
  assert.equal(phone.respondedAt,calledAt);
  const registered=await api('buyer','GET',`/api/p2p/consultations?view=summary&search=${encodeURIComponent(purchase.ref)}`);
  assert(registered.data.items.some(x=>x.id===consultation.id&&x.requestRefs.includes(purchase.ref)));
  assert(registered.data.items.every(x=>!('lines' in x)&&!('recipients' in x)));
  const opened=await api('buyer','GET',`/api/p2p/consultations?id=${consultation.id}`);
  assert.equal(opened.data.items[0].lines[0].offers[0].id,phone.id);
  const answered=await api('buyer','GET',`/api/p2p/consultations?view=summary&status=no_response&supplierId=${suppliers[0].id}`);
  const unanswered=await api('buyer','GET',`/api/p2p/consultations?view=summary&status=no_response&supplierId=${suppliers[1].id}`);
  assert(!answered.data.items.some(x=>x.id===consultation.id));
  assert(unanswered.data.items.some(x=>x.id===consultation.id));
  const createdDay=opened.data.items[0].createdAt.slice(0,10);
  assert((await api('buyer','GET',`/api/p2p/consultations?view=summary&from=${createdDay}&to=${createdDay}`)).data.items.some(x=>x.id===consultation.id));
  await api('buyer','GET','/api/p2p/consultations?from=2099-12-31&to=2099-01-01',null,[400]);

  const validUntil=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  const email={...common,action:'offer',evidenceChannel:'email',supplierId:suppliers[1].id,qty:40,quoteRef:'E2E-EMAIL',validUntil};
  await api('buyer','POST','/api/p2p/sourcing',email,[400]);
  const {data:{result:written}}=await api('buyer','POST','/api/p2p/sourcing',{...email,documentRef:'Message fournisseur E2E-01'});
  const proposal={action:'propose',rfqId,reason:'Répartition test documentée de 100 kg',allocations:[{offerId:phone.id,qty:60},{offerId:written.id,qty:40}]};
  await api('buyer','POST','/api/p2p/awards',proposal,[409]);
  await api('buyer','POST','/api/p2p/sourcing',{action:'validatePhoneOffer',offerId:phone.id,validUntil,validationNote:'Appel vérifié avec le fournisseur'});
  const {data:{result:{planId}}}=await api('buyer','POST','/api/p2p/awards',proposal);
  const waiting = await api('approver','GET','/api/p2p/consultations?status=pending_approval');
  assert(waiting.data.items.some(c=>c.id===consultation.id));
  const approve={action:'approve',planId};
  await api('buyer','POST','/api/p2p/awards',approve,[409]);
  const decisions=await Promise.all([1,2].map(()=>api('approver','POST','/api/p2p/awards',approve,[201,409])));
  assert.deepEqual(decisions.map(x=>x.response.status).sort(),[201,409]);
  const generated=await Promise.all([1,2].map(()=>api('buyer','POST','/api/p2p/awards',{action:'createDraftOrders',planId},[201,409])));
  assert.deepEqual(generated.map(x=>x.response.status).sort(),[201,409]);
  const orders=generated.find(x=>x.response.status===201).data.result.orders;
  assert.deepEqual(orders.map(x=>[x.supplierId,x.qty]).sort((a,b)=>a[0]-b[0]),[[suppliers[0].id,60],[suppliers[1].id,40]]);
  for(const bc of orders) await api('approver','PATCH',`/api/supplier-orders/${bc.id}`,{action:'approve'});
  const additional = await api('buyer','POST','/api/purchases',{
    duplicateJustification:'Deuxième besoin indépendant pour recette des destinataires',
    lines:[{materialId,qty:5}],
  });
  const extra = additional.data.purchase;
  const extraLine = extra.lines[0].id;
  await api('approver','PATCH',`/api/purchases/${extra.id}`,{action:'advance'});
  const {data:position}=await api('buyer','GET','/api/materials/da-followup?scope=open&pageSize=1');
  assert(position.byMaterial[materialId].history.some(da=>da.id===purchase.id));
  assert(position.byMaterial[materialId].history.some(da=>da.id===extra.id));
  assert.equal(position.supply[materialId].inbound.reduce((sum,line)=>sum+line.qty,0),100);
  const bc=orders.find(x=>x.qty===60);
  const line=database.prepare('SELECT id FROM SupplierOrderLine WHERE orderId=?').get(bc.id);
  const delivery={supplierOrderId:bc.id,deliveryRef:'DMAIC-BL',lines:[{supplierOrderLineId:line.id,acceptedQty:7,rejectedQty:3,lot:'DMAIC-LOT'}]};
  const received=await Promise.all([1,2].map(()=>api('receiver','POST','/api/goods-receipts',delivery,[201,409])));
  assert.deepEqual(received.map(x=>x.response.status).sort(),[201,409]);
  await api('receiver','POST','/api/goods-receipts',{...delivery,deliveryRef:'DMAIC-EXCESS',lines:[{...delivery.lines[0],acceptedQty:60,rejectedQty:0}]},[409]);
  const held=database.prepare("SELECT id FROM StockLot WHERE lotCode='DMAIC-LOT' AND status='quarantine'").get();
  assert(held);
  const getStock=()=>database.prepare('SELECT stockQty FROM Material WHERE id=?').get(materialId).stockQty;
  assert(Math.abs(getStock()-stock0-7)<1e-6);
  await api('quality','POST','/api/quality-inspections',{stockLotId:held.id,qty:3,decision:'release',reason:'Contrôle qualité favorable en recette'});
  const available=database.prepare("SELECT id FROM StockLot WHERE lotCode='DMAIC-LOT' AND status='available' ORDER BY id LIMIT 1").get();
  await api('quality','POST','/api/supplier-returns',{stockLotId:available.id,qty:2,reason:'Retour fictif après réception',creditExpected:false});
  assert(Math.abs(getStock()-stock0-8)<1e-6);
  const oldCost=Number(opening.averageCost??opening.unitPrice);
  const acceptedCost=Number(((stock0*oldCost+7*10)/(stock0+7)).toFixed(6));
  const expectedCump=Number((((stock0+7)*acceptedCost+3*10)/(stock0+10)).toFixed(6));
  const actualCump=Number(database.prepare('SELECT averageCost FROM Material WHERE id=?').get(materialId).averageCost);
  assert(Math.abs(actualCump-expectedCump)<1e-6);
  console.log(`PASS CUMP ${actualCump.toFixed(6)} ; stock initial ${stock0} ; stock final ${getStock()}`);

  const receiptLine=database.prepare('SELECT id FROM GoodsReceiptLine WHERE supplierOrderLineId=?').get(line.id);
  const {data:invoice}=await api('finance','POST','/api/supplier-invoices',{
    supplierId:bc.supplierId,invoiceNumber:'DMAIC-FACT',invoiceDate:new Date().toISOString().slice(0,10),freightAmount:0,
    lines:[{receiptLineId:receiptLine.id,qty:8,unitPrice:10,taxRate:0}],
  });
  assert.equal(invoice.status,'matched');
  await api('finance','PATCH',`/api/supplier-invoices/${invoice.id}`,{action:'approve'},[409]);
  await api('finance2','PATCH',`/api/supplier-invoices/${invoice.id}`,{action:'approve'});
  const {data:payment}=await api('finance2','PATCH',`/api/supplier-invoices/${invoice.id}`,{action:'payment',reference:'DMAIC-PAIE',amount:30});
  assert.notEqual(payment.status,'paid');
  const {data:paid}=await api('finance2','PATCH',`/api/supplier-invoices/${invoice.id}`,{action:'payment',reference:'DMAIC-SOLDE',amount:50});
  assert.equal(paid.status,'paid');
  const totals=database.prepare("SELECT SUM(qty) AS qty FROM StockLot WHERE materialId=? AND status='available'").get(materialId);
  assert(Math.abs(totals.qty-getStock())<1e-6);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const extra2=(await api('buyer','POST','/api/purchases',{
    duplicateJustification:'Troisième besoin indépendant pour recette des destinataires',
    lines:[{materialId,qty:3}],
  })).data.purchase;
  await api('approver','PATCH',`/api/purchases/${extra2.id}`,{action:'advance'});
  const perLine={
    lines:[
      {requestLineId:extraLine,qty:5,supplierIds:[suppliers[0].id]},
      {requestLineId:extra2.lines[0].id,qty:3,supplierIds:[suppliers[1].id]},
    ],
    supplierIds:suppliers.map(s=>s.id),
  };
  await api('buyer','POST','/api/p2p/consultations',{...perLine,lines:[{...perLine.lines[0],supplierIds:[999999]},perLine.lines[1]]},[409]);
  const routed=(await api('buyer','POST','/api/p2p/consultations',perLine)).data.consultation;
  const mappings=database.prepare(`
    SELECT rfq.requestLineId,r.supplierId FROM SupplierConsultationRecipientLine l
    JOIN SupplierConsultationRecipient r ON r.id=l.recipientId
    JOIN SupplierRFQ rfq ON rfq.id=l.rfqId WHERE r.consultationId=? ORDER BY rfq.requestLineId
  `).all(routed.id);
  assert.deepEqual(mappings.map(x=>[x.requestLineId,x.supplierId]),[[extraLine,suppliers[0].id],[extra2.lines[0].id,suppliers[1].id]]);
  const pdfRfq=database.prepare('SELECT id FROM SupplierRFQ WHERE requestLineId=?').get(extraLine).id;
  const pdfOffer=(await api('buyer','POST','/api/p2p/sourcing',{
    action:'offer',rfqId:pdfRfq,supplierId:suppliers[0].id,unitPrice:10,leadTimeDays:3,qty:5,quoteRef:'DMAIC-PDF',validUntil,
  })).data.result;
  const pdfPlan={action:'propose',rfqId:pdfRfq,reason:'Attribution avec devis écrit justificatif',allocations:[{offerId:pdfOffer.id,qty:5}]};
  await api('buyer','POST','/api/p2p/awards',pdfPlan,[409]);
  const form=new FormData();
  form.set('offerId',String(pdfOffer.id));
  form.set('file',new Blob(['%PDF-1.4\n% Pièce synthétique de recette\n'],{type:'application/pdf'}),'recette.pdf');
  const upload=await fetch(base+'/api/p2p/offer-documents',{method:'POST',headers:{origin:base,cookie:cookies.buyer},body:form});
  assert.equal(upload.status,201);
  checks.push('buyer POST /api/p2p/offer-documents 201');
  const pdfPlanId=(await api('buyer','POST','/api/p2p/awards',pdfPlan)).data.result.planId;
  await api('approver','POST','/api/p2p/awards',{action:'approve',planId:pdfPlanId});

  const agreement=(await api('buyer','POST','/api/p2p/sourcing',{
    action:'agreement',supplierId:suppliers[1].id,materialId,contractRef:'DMAIC-ACCORD',documentRef:'Accord de recette',
    unitPrice:10,validFrom:new Date(Date.now()-86400000).toISOString().slice(0,10),validUntil,
  })).data.result;
  await api('buyer','POST','/api/p2p/sourcing',{action:'approveAgreement',agreementId:agreement.id},[409]);
  await api('approver','POST','/api/p2p/sourcing',{action:'approveAgreement',agreementId:agreement.id});
  await api('buyer','POST','/api/supplier-orders',{
    supplierId:suppliers[1].id,lines:[{requestLineId:extra2.lines[0].id,qty:3,unitPrice:10,sourceType:'CONTRACT',sourceId:agreement.id}],
  },[409]);
  const contractRfq=database.prepare('SELECT id FROM SupplierRFQ WHERE requestLineId=?').get(extra2.lines[0].id).id;
  const contractPlan=(await api('buyer','POST','/api/p2p/awards',{
    action:'propose',rfqId:contractRfq,reason:'Attribution documentée sur contrat en cours',
    allocations:[{sourceType:'CONTRACT',sourceId:agreement.id,qty:3}],
  })).data.result.planId;
  await api('approver','POST','/api/p2p/awards',{action:'approve',planId:contractPlan});
  const [contractualOrder]=(await api('buyer','POST','/api/p2p/awards',{action:'createDraftOrders',planId:contractPlan})).data.result.orders;
  await api('approver','PATCH',`/api/supplier-orders/${contractualOrder.id}`,{action:'approve'});
  const registerCases=[
    ['buyer','purchases',purchase.ref],
    ['buyer','supplier-orders',purchase.ref],
    ['receiver','goods-receipts','DMAIC-BL'],
    ['quality','stock-lots','DMAIC-LOT'],
    ['finance','supplier-invoices','DMAIC-FACT'],
  ];
  for(const [role,path,query] of registerCases){
    const {data}=await api(role,'GET',`/api/${path}?view=register&pageSize=1&q=${encodeURIComponent(query)}`);
    assert(data.pagination.total>0,path);
    assert.equal(data.items.length,1,path);
  }
  const sortedBC=(await api('buyer','GET','/api/supplier-orders?view=register&sort=montant&dir=asc')).data.items;
  const bcAmounts=sortedBC.map(order=>order.lines.reduce((sum,line)=>sum+line.qty*line.unitPrice,0));
  assert.deepEqual(bcAmounts,[...bcAmounts].sort((a,b)=>a-b));
  const openOrders=(await api('receiver','GET',`/api/supplier-orders?view=receivable&q=${encodeURIComponent(contractualOrder.ref)}`)).data.items;
  assert.deepEqual(openOrders.map(o=>o.id),[contractualOrder.id]);
  assert(openOrders[0].lines.every(line=>line.unitPrice===null));
  const supplierReceipts=(await api('finance','GET',`/api/goods-receipts?view=register&supplierId=${bc.supplierId}&q=DMAIC-BL`)).data.items;
  assert.equal(supplierReceipts[0].supplierOrder.supplierId,bc.supplierId);
  const supplierChoices=(await api('finance','GET','/api/suppliers?view=choices')).data.items;
  assert(supplierChoices.some(x=>x.id===bc.supplierId));
  assert(supplierChoices.every(x=>Object.keys(x).every(k=>['id','name'].includes(k))));
  database.close();
  if(process.env.GOCMD_QA_PLAYWRIGHT) await browserChecks();

}

async function browserChecks() {
  const {chromium}=require(process.env.GOCMD_QA_PLAYWRIGHT);
  const browser=await chromium.launch({executablePath:process.env.GOCMD_QA_CHROMIUM,args:['--no-sandbox']});
  try {
    for(const viewport of [{width:1366,height:768},{width:820,height:1180}]) {
      const context=await browser.newContext({viewport});
      await context.addCookies([{name:'gocmd_session',value:cookies.buyer.slice('gocmd_session='.length),url:base}]);
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base);
      const journey=page.getByRole('navigation',{name:'Étapes du circuit achats'});
      await journey.getByRole('button',{name:'Matières',exact:true}).click({timeout:12000});
      await page.getByText(/Prévision BC :/).first().waitFor({timeout:12000});
      await page.getByRole('region',{name:'Tableau des matières premières'}).waitFor();
      await journey.getByRole('button',{name:'Demandes (DA)',exact:true}).click();
      await page.getByRole('button',{name:'Consulter plusieurs DA'}).first().click({timeout:12000});
      const dialog=page.getByRole('dialog',{name:'Consultation multi-DA et multi-fournisseurs'});
      await dialog.getByRole('textbox',{name:'Rechercher une DA ou une matière'}).fill('introuvable-recette');
      await dialog.getByText('Aucune ligne éligible pour ces filtres.').waitFor();
      await dialog.getByRole('textbox',{name:'Rechercher une DA ou une matière'}).clear();
      await dialog.getByText('3. Fournisseurs destinataires').waitFor();
      assert.deepEqual(errors,[]);
      console.log(`PASS Chromium ${viewport.width}×${viewport.height} : matières, DA, filtres et préparation consultation`);
      await context.close();
    }
    if(process.env.GOCMD_QA_UX_MATRIX) await screenMatrix(browser);
  } finally {await browser.close()}
}

async function screenMatrix(browser) {
  const matrix=[
    ['purebuyer','buyer-workbench','Ruptures à acheter'],
    ['purebuyer','materials','Tableau des matières premières'],
    ['purebuyer','purchases','Rechercher une DA'],
    ['purebuyer','suppliers','Fournisseurs enregistrés'],
    ['purebuyer','p2p-advanced','Liste des dossiers de consultation'],
    ['purebuyer','supplier-orders','Statut du BC'],
    ['purebuyer','goods-receipts','Historique des BR'],
    ['receiver','goods-receipts','Nouveau bon de réception'],
    ['quality','stock-lots','Statut du lot'],
    ['finance','supplier-invoices','Statut de la facture'],
    ['approver','purchases','Rechercher une DA'],
  ];
  let failures=0;
  for(const viewport of [
    {width:1920,height:1080},{width:1366,height:768},{width:1024,height:768},
    {width:360,height:800},{width:768,height:1024},{width:390,height:844},
    {width:375,height:812},{width:320,height:720},
  ]){
    for(const [role,view,marker] of matrix){
      if(process.env.GOCMD_QA_UX_VIEW && view!==process.env.GOCMD_QA_UX_VIEW)continue;
      const context=await browser.newContext({viewport});
      await context.addCookies([{name:'gocmd_session',value:cookies[role].slice('gocmd_session='.length),url:base}]);
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      const started=performance.now();
      try{
        await page.goto(base+'/?vue='+view);
        const main=page.locator('main');
        const element=main.getByLabel(marker,{exact:true}).or(main.getByText(marker,{exact:false})).first();
        await element.waitFor({timeout:10000});
        if(view==='p2p-advanced'){
          const list=page.getByRole('region',{name:'Liste des dossiers de consultation'});
          const rows=list.getByRole('button',{name:/^Ouvrir CONS-/});
          await rows.first().click();
          const dialog=page.getByRole('dialog');
          await dialog.getByRole('heading',{name:/^CONS-/}).waitFor({timeout:10000});
          await dialog.getByText('Comparer les offres, consulter les pièces et suivre les décisions.').waitFor({timeout:10000});
          await page.keyboard.press('Escape');
          await page.getByRole('dialog').waitFor({state:'hidden'});
          await page.getByRole('textbox',{name:'Consultation, DA, matière ou fournisseur'}).fill('introuvable-ux');
          await page.getByRole('button',{name:'Appliquer les filtres'}).click();
          await page.getByText('Aucun dossier pour cette page et ces filtres.').waitFor();
          await page.getByRole('button',{name:'Réinitialiser'}).click();
          await list.waitFor();
        }
        await page.waitForTimeout(150);
        const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth));
        if(overflow)console.log('UX_OVERFLOW '+JSON.stringify({role,view,...viewport,elements:await page.evaluate(()=>
          [...document.querySelectorAll('main *')].filter(e=>{
            const r=e.getBoundingClientRect();return r.width>0&&r.right>document.documentElement.clientWidth;
          }).slice(0,30).map(e=>({tag:e.tagName,id:e.id,class:e.className,text:e.textContent?.slice(0,100),right:e.getBoundingClientRect().right}))
        )}));
        if(process.env.GOCMD_QA_ARTIFACTS){
          require('node:fs').mkdirSync(process.env.GOCMD_QA_ARTIFACTS,{recursive:true,mode:0o700});
          await page.screenshot({path:join(process.env.GOCMD_QA_ARTIFACTS,`${role}_${view}_${viewport.width}x${viewport.height}.png`),fullPage:true});
        }
        console.log('UX_MEASURE '+JSON.stringify({role,view,...viewport,overflow,durationMs:Math.round(performance.now()-started),pageErrors:errors.length}));
        assert.equal(overflow,0,`débordement du document de ${overflow} px`);
        assert.deepEqual(errors,[]);
        if(role==='purebuyer'&&view==='goods-receipts')assert.equal(await main.getByText('Nouveau bon de réception (BR)').count(),0);
        console.log(`PASS UX ${viewport.width}×${viewport.height} ${role} ${view}`);
      }catch(e){failures++;console.log(`FAIL UX ${viewport.width}×${viewport.height} ${role} ${view}: ${e.message.split('\n')[0]}`)}
      finally {await context.close()}
    }
  }
  assert.equal(failures,0,'Échecs de la matrice d’écrans');
}

run().then(()=>console.log(months?'Fin de campagne six mois':'PASS recette HTTP production DMAIC, attribution 60/40, contrôle quatre yeux, doublons, stock, facture et paiement'))
  .catch(error=>{console.error(error.message);process.exitCode=1})
  .finally(async()=>{
    console.log(checks.join('\n'));
    if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill();await exited;}
    rmSync(temp,{recursive:true,force:true});
  });
