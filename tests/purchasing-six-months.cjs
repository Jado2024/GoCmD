'use strict';
const assert=require('node:assert/strict');
module.exports=async ({api,cookies,database:db,temp,login,advance})=>{
  // Optional durable evidence, outside the disposable application database.
  const artifacts=process.env.GOCMD_QA_ARTIFACTS;
  const {mkdirSync,writeFileSync}=require('node:fs');
  const {join,resolve}=require('node:path');
  function snapshot(period){
    if(!artifacts)return;
    mkdirSync(artifacts,{recursive:true,mode:0o700});
    const file=resolve(artifacts,period+'.db');
    db.exec("VACUUM INTO '"+file.replace(/'/g,"''")+"'");
    console.log('SNAPSHOT '+JSON.stringify({period,file}));
  }
  snapshot('2026-10-opening');
  let date='2026-11-09', sequence=0, failed=0;
  const results=[];
  const controls=require('./six-months-controls.cjs');
  const o2c=require('./six-months-sales.cjs')({api,db});
  const P='/api/purchases', C='/api/p2p/consultations', S='/api/p2p/sourcing', A='/api/p2p/awards';
  const B='/api/supplier-orders', R='/api/goods-receipts', I='/api/supplier-invoices', F='/api/p2p/finance';
  const post=async (who,path,body,status)=>(await api(who,'POST',path,body,status)).data;
  const patch=async (who,path,body,status)=>(await api(who,'PATCH',path,body,status)).data;
  const get=async (who,path)=>(await api(who,'GET',path)).data;
  const reason='Décision documentée pour la recette SODEPI';
  const datePlus=days=>new Date(Date.parse(date+'T09:00:00Z')+days*86400000).toISOString().slice(0,10);
  const label=()=>date.slice(0,7)+'-'+(++sequence);
  async function check(id,title,fn){
    try {await fn();results.push({date,id,title,result:'PASS'});}
    catch(error){failed++;results.push({date,id,title,result:'FAIL',detail:error.message});}
    console.log('CAS '+JSON.stringify(results.at(-1)));
  }
  function checkpoint(period) {
    const [year,month]=period.split('-').map(Number);
    const closedAt=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
    advance(closedAt);
    const tables=['PurchaseRequest','SupplierConsultation','SupplierQuoteOffer','SupplierPriceAgreement','SupplierAwardPlan',
      'SupplierOrder','GoodsReceipt','Movement','StockLot','StockCount','QualityInspection','SupplierInvoice','SupplierPayment',
      'SupplierCreditNote','SalesQuote','Order','SalesStockReservation','SalesDelivery','SalesInvoice','SalesPayment','SalesCreditNote','AuditEvent'];
    const counts=Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT count(*) n FROM "'+table+'"').get().n]));
    const states=Object.fromEntries(['PurchaseRequest','SupplierOrder','SupplierInvoice','SalesInvoice'].map(table=>[
      table,db.prepare('SELECT status,count(*) n FROM "'+table+'" GROUP BY status ORDER BY status').all(),
    ]));
    const stock=db.prepare('SELECT id,unit,stockQty,averageCost FROM Material ORDER BY id').all();
    const lotDrift=db.prepare("SELECT id FROM Material m WHERE abs(stockQty-coalesce((SELECT sum(qty) FROM StockLot WHERE materialId=m.id AND status='available'),0))>0.000001").all();
    const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();
    const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
    const totals=db.prepare(`SELECT
      (SELECT coalesce(sum(totalCents),0) FROM SalesInvoice) salesInvoiceCents,
      (SELECT coalesce(sum(amountCents),0) FROM SalesPayment) salesPaidCents,
      (SELECT coalesce(sum(amountCents),0) FROM SalesCreditNote WHERE status='approved') salesCreditCents`).get();
    totals.salesBalanceCents=totals.salesInvoiceCents-totals.salesPaidCents-totals.salesCreditCents;
    const evidence={period,closedAt,counts,states,stock,totals,lotDrift,foreignKeys,integrity};
    console.log('MONTH_END '+JSON.stringify(evidence));
    assert.equal(integrity,'ok');
    assert.deepEqual(lotDrift,[]);
    assert.deepEqual(foreignKeys,[]);
    snapshot(period);
    if(artifacts)writeFileSync(join(artifacts,period+'.json'),JSON.stringify(evidence,null,2));
  }
  async function month(day) {
    const previous=date;
    if(day!==previous) checkpoint(previous.slice(0,7));
    date=day;advance(day);
    if(day!==previous) await check('AUTH-'+day.slice(0,7),'Session du mois précédent expirée',async()=>{
      await api('buyer','GET','/api/me',null,[401]);
    });
    await login();
  }
  const materials=db.prepare(`
    SELECT m.id,m.unit,m.stockQty,m.minStock,group_concat(sm.supplierId) suppliers FROM Material m
    JOIN SupplierMaterial sm ON sm.materialId=m.id JOIN Supplier s ON s.id=sm.supplierId AND s.active=1
    WHERE m.unit='kg' AND m.isPurchasable=1 AND sm.unitsPerPurchase=1 GROUP BY m.id HAVING count(*)>=2
    ORDER BY m.id
  `).all().map(m=>({...m,suppliers:m.suppliers.split(',').map(Number).sort((a,b)=>a-b)}));
  assert(materials.length>=3);
  const [m1,m2,m3]=materials;
  const block=db.prepare("SELECT id FROM Material WHERE unit='bloc' AND isPurchasable=1 LIMIT 1").get();
  const manufactured=db.prepare("SELECT id FROM Material WHERE foamNature='AGGLO' LIMIT 1").get();
  const supplierIds=[...new Set(materials.flatMap(m=>m.suppliers))];
  const da=async (m,qty=10)=>(await post('buyer',P,{note:'Besoin '+label(),expectedDate:datePlus(15)+'T12:00:00Z',duplicateJustification:reason,lines:[{materialId:m.id,qty}]})).purchase;
  const approveDa=async d=>(await patch('approver',P+'/'+d.id,{action:'advance'})).purchase;
  const qualify=async(supplierId,status='approved',expiresAt=datePlus(31))=>{
    const data=await post('approver',S,{action:'qualify',supplierId,status,score:90,note:reason,expiresAt});
    assert.equal(data.result.reviewedAt.slice(0,10),date);
    return data;
  };
  async function consult(d,m,qty,suppliers=m.suppliers){
    const requestLineId=d.lines[0].id;
    const group=(await post('buyer',C,{lines:[{requestLineId,qty,supplierIds:suppliers}],supplierIds:suppliers,deadline:datePlus(8)})).consultation;
    return db.prepare('SELECT rfqId AS id FROM SupplierConsultationLine WHERE consultationId=?').get(group.id);
  }
  async function offer(r,supplierId,qty,validUntil=datePlus(20),unitPrice=10){
    return (await post('buyer',S,{action:'offer',evidenceChannel:'email',rfqId:r.id,supplierId,qty,unitPrice,priceBasis:'STOCK',leadTimeDays:4,quoteRef:'OFF-'+label(),documentRef:'Courriel fictif '+label(),validUntil})).result;
  }
  const propose=(r,o,qty,status)=>post('buyer',A,{action:'propose',rfqId:r.id,reason,allocations:[{offerId:o.id,qty}]},status);
  async function createBC(m,qty=10){
    const d=await approveDa(await da(m,qty));
    const r=await consult(d,m,qty);
    const o=await offer(r,m.suppliers[0],qty);
    const plan=(await propose(r,o,qty)).result.planId;
    await post('approver',A,{action:'approve',planId:plan});
    const [order]=(await post('buyer',A,{action:'createDraftOrders',planId:plan})).result.orders;
    const line=db.prepare('SELECT id FROM SupplierOrderLine WHERE orderId=?').get(order.id);
    return {order,line,d};
  }
  const approveBC=({order})=>patch('approver',B+'/'+order.id,{action:'approve'});
  async function receive({order,line},acceptedQty,rejectedQty=0){
    const deliveryRef='BL-'+label(),lot='LOT-'+label();
    await post('receiver',R,{supplierOrderId:order.id,deliveryRef,lines:[{supplierOrderLineId:line.id,acceptedQty,rejectedQty,lot}]});
    const receipt=db.prepare('SELECT id FROM GoodsReceiptLine WHERE supplierOrderLineId=? ORDER BY id DESC LIMIT 1').get(line.id);
    return {receipt,lot};
  }
  const invoice=(supplierId,receiptLineId,qty,unitPrice=10)=>({supplierId,invoiceNumber:'FAC-'+label(),invoiceDate:date,lines:[{receiptLineId,qty,unitPrice,taxRate:0}]});

  await month('2026-11-09');
  await check('ADMIN-01','Compte multi-rôle, renouvellement initial, refus explicite et révocations',()=>controls.accounts({api,cookies}));
  await check('O2C-OPEN','Devis, acceptation et conversion du client fictif',()=>o2c.open(date));
  await check('DA-01','Quantités invalides, bloc fractionnaire, matière fabriquée et rôle ventes',async()=>{
    for(const [materialId,qty,status] of [[m1.id,0,400],[m1.id,-2,400],[block.id,0.5,400],[manufactured.id,2,409]])
      await post('buyer',P,{lines:[{materialId,qty}]},[status]);
    await post('sales',P,{lines:[{materialId:m1.id,qty:10}]},[403]);
  });
  await check('DA-02','DA multiligne : décision incomplète refusée, réduction et rejet motivés',async()=>{
    const {purchase:d}=await post('buyer',P,{lines:[{materialId:m1.id,qty:20},{materialId:m2.id,qty:10},{materialId:m3.id,qty:6}]});
    const [a,b,c]=[m1,m2,m3].map(m=>d.lines.find(l=>l.materialId===m.id));
    const decisions=[{lineId:a.id,decision:'reduce',approvedQty:12,reason},{lineId:b.id,decision:'reject',reason},{lineId:c.id,decision:'approve'}];
    await patch('approver',P+'/'+d.id,{action:'decide-lines',decisions:decisions.slice(0,1)},[409]);
    const result=await patch('approver',P+'/'+d.id,{action:'decide-lines',decisions});
    assert.equal(result.purchase.status,'partially_approved');
    assert.equal(result.purchase.lines.find(l=>l.id===a.id).approvedQty,12);
    assert.equal(result.purchase.lines.find(l=>l.id===b.id).approvedQty,0);
    await post('buyer',C,{lines:[{requestLineId:a.id,qty:13}],supplierIds:[m1.suppliers[0]]},[409]);
  });
  await check('DA-03','Doublon de DA ouverte, justification, annulation et refus total',async()=>{
    await post('buyer',P,{lines:[{materialId:m1.id,qty:3}]},[409]);
    const d=await da(m1,3);
    await patch('approver',P+'/'+d.id,{action:'cancel'},[409]);
    assert.equal((await patch('approver',P+'/'+d.id,{action:'cancel',reason})).purchase.status,'cancelled');
    const refused=await da(m1,4);
    assert.equal((await patch('approver',P+'/'+refused.id,{action:'decide-lines',decisions:[{lineId:refused.lines[0].id,decision:'reject',reason}]})).purchase.status,'rejected');
    await post('buyer',C,{lines:[{requestLineId:refused.lines[0].id,qty:1}],supplierIds:m1.suppliers},[409]);
  });
  await check('FOU-01','Référencement des fournisseurs, qualification et droits',async()=>{
    for(const supplierId of supplierIds)await qualify(supplierId,'approved','2027-05-31');
    await post('purebuyer',S,{action:'qualify',supplierId:m1.suppliers[0],status:'approved',score:90,note:reason},[403]);
    const {supplier}=await post('buyer','/api/suppliers',{name:'Fournisseur campagne six mois'});
    assert(supplier.id);
    await post('buyer','/api/suppliers',{name:'Fournisseur campagne six mois'},[409]);
    await post('buyer','/api/suppliers',{action:'link',supplierId:supplier.id,materialId:m1.id,unitPrice:10,purchaseUnit:'kg',unitsPerPurchase:1});
    await patch('buyer','/api/suppliers',{supplierId:supplier.id,active:false});
    const d=await approveDa(await da(m1,4));
    await post('buyer',C,{lines:[{requestLineId:d.lines[0].id,qty:4}],supplierIds:[supplier.id]},[409]);
  });
  await check('M01','Rapprochement initial des matières, réservations et besoins ouverts',async()=>{
    const x=await get('buyer','/api/materials/da-followup?scope=open&pageSize=1');
    assert(x.byMaterial[m1.id].history.length>=1);
    await api('sales','GET','/api/materials/da-followup?scope=open',null,[403]);
  });

  await month('2026-12-07');
  await check('NEGOCE-01','Article commun, réservation concurrente, BL partiel idempotent et reliquat',()=>controls.trade({api,db,date}));
  await check('O2C-PARTIAL','Bon de livraison partiel, solde reporté',()=>o2c.partial(date));
  let expiredDraft, crossMonth;
  await check('CON-01','Invitation, relance, refus, RFQ clôturée et offre tardive',async()=>{
    const d=await approveDa(await da(m1));
    const r=await consult(d,m1,10);
    const contact={rfqId:r.id,supplierId:m1.suppliers[0]};
    for(const action of ['contacted','reminded','declined'])await post('buyer','/api/p2p/consultation-responses',{...contact,action,reason});
    await post('buyer','/api/p2p/consultation-responses',{...contact,action:'reminded'},[409]);
    await post('buyer',S,{action:'closeRfq',rfqId:r.id});
    await post('buyer',S,{action:'oralOffer',rfqId:r.id,supplierId:m1.suppliers[1],qty:10,unitPrice:10,leadTimeDays:2,contactName:'Contact QA',callSummary:reason},[409]);
  });
  await check('OFF-01','Version d’offre révisée, refus de plan puis nouvelle décision',async()=>{
    const d=await approveDa(await da(m2));
    const r=await consult(d,m2,10);
    const o=await offer(r,m2.suppliers[0],10);
    const revised=(await post('buyer',S,{action:'reviseOffer',offerId:o.id,qty:10,unitPrice:11,leadTimeDays:2,priceBasis:'STOCK',quoteRef:'REV-'+label(),documentRef:'Message révisé',validUntil:datePlus(20),reason})).result;
    assert.equal(revised.revisionNo,2);
    const first=(await propose(r,revised,10)).result.planId;
    await post('approver',A,{action:'reject',planId:first,decisionNote:reason});
    const second=(await propose(r,revised,10)).result.planId;
    assert.notEqual(first,second);
    await post('approver',A,{action:'approve',planId:second});
  });
  await check('BC-01','Préparer deux BC, confirmer l’un et conserver son reliquat au changement de mois',async()=>{
    expiredDraft=await createBC(m1);
    crossMonth=await createBC(m3,12);
    await approveBC(crossMonth);
    await receive(crossMonth,4,2);
  });

  await month('2027-01-11');
  await check('O2C-COMPLETE','Deux commerciaux tentent le même reliquat en parallèle',()=>o2c.complete(date));
  await check('OFF-02','Devis expiré entre la création et l’approbation du BC',async()=>{
    assert(expiredDraft,'BC de décembre indisponible');
    await patch('approver',B+'/'+expiredDraft.order.id,{action:'approve'},[409]);
    assert.equal(db.prepare('SELECT status FROM SupplierOrder WHERE id=?').get(expiredDraft.order.id).status,'draft');
  });
  await check('REC-01','Réception reportée, mise en quarantaine, contrôle qualité et solde',async()=>{
    assert(crossMonth,'BC de décembre indisponible');
    const row=db.prepare('SELECT id FROM StockLot WHERE receiptLineId IN (SELECT id FROM GoodsReceiptLine WHERE supplierOrderLineId=?) AND status=\'quarantine\'').get(crossMonth.line.id);
    await post('receiver','/api/quality-inspections',{stockLotId:row.id,qty:1,decision:'release',reason},[403]);
    await post('quality','/api/quality-inspections',{stockLotId:row.id,qty:1,decision:'release',reason});
    const released=db.prepare("SELECT id FROM StockLot WHERE lotCode=(SELECT lotCode FROM StockLot WHERE id=?) AND status='available' ORDER BY id DESC LIMIT 1").get(row.id);
    await post('quality','/api/quality-inspections',{stockLotId:released.id,qty:1,decision:'reject',reason});
    await post('quality','/api/quality-inspections',{stockLotId:row.id,qty:2,decision:'release',reason});
    await receive(crossMonth,6);
    assert.equal(db.prepare('SELECT status FROM SupplierOrder WHERE id=?').get(crossMonth.order.id).status,'received');
  });
  await check('FOU-02','Suspension après création du BC, refus puis requalification',async()=>{
    const bc=await createBC(m2);
    await qualify(bc.order.supplierId,'suspended');
    await patch('approver',B+'/'+bc.order.id,{action:'approve'},[409]);
    await qualify(bc.order.supplierId,'approved','2027-05-31');
    await approveBC(bc);
    await receive(bc,10);
  });

  await month('2027-02-08');
  await check('O2C-BILL','Facture unique et paiement partiel autorisé',()=>o2c.bill(date));
  let payable;
  await check('FIN-01','Écart de prix/quantité, refus de paiement, rejet et facture rectifiée',async()=>{
    const bc=await createBC(m1);await approveBC(bc);
    const {receipt}=await receive(bc,10);
    const input=invoice(bc.order.supplierId,receipt.id,11,15);
    const wrong=await post('finance',I,input);
    assert.equal(wrong.status,'blocked');
    assert.equal(wrong.issues.length,2);
    await patch('finance2',I+'/'+wrong.id,{action:'payment',reference:'INVALIDE-'+label(),amount:1},[409]);
    await patch('finance2',I+'/'+wrong.id,{action:'reject',reason});
    payable=await post('finance',I,{...invoice(bc.order.supplierId,receipt.id,10),replacesInvoiceId:wrong.id});
    assert.equal(payable.status,'matched');
    await post('finance',I,input,[409]);
    await patch('finance2',I+'/'+payable.id,{action:'approve'});
  });
  await check('BC-02','Révision d’un BC, visa retiré et contrôle quatre yeux',async()=>{
    const bc=await createBC(m3);await approveBC(bc);
    await post('buyer',S,{action:'revision',orderId:bc.order.id,reason,lines:[{id:bc.line.id,qty:8,unitPrice:10}]});
    assert.equal(db.prepare('SELECT status FROM SupplierOrder WHERE id=?').get(bc.order.id).status,'draft');
    await patch('buyer',B+'/'+bc.order.id,{action:'approve'},[409]);
    await approveBC(bc);
    await receive(bc,8);
    await patch('approver',P+'/'+bc.d.id,{action:'close',reason});
  });

  await month('2027-03-08');
  await check('INV-01','Inventaire concurrent, ajustement et validation indépendante',()=>controls.stockCount({api,db}));
  await check('O2C-CREDIT','Avoir commercial avec approbation indépendante',()=>o2c.credit(date));
  await check('FIN-02','Avoir sur solde, double contrôle et paiements concurrents',async()=>{
    assert(payable,'Facture de février indisponible');
    const inv=I+'/'+payable.id;
    const credit=(await post('finance',F,{action:'credit',invoiceId:payable.id,amount:25,reason})).result;
    await post('finance',F,{action:'approve-credit',creditId:credit.id},[409]);
    await patch('finance2',inv,{action:'payment',reference:'DEPASSE-'+label(),amount:100},[409]);
    await post('finance2',F,{action:'approve-credit',creditId:credit.id});
    const statuses=await Promise.all([1,2].map(async()=> (await api('finance2','PATCH',inv,{action:'payment',reference:'PAY-'+label(),amount:75},[200,409])).response.status));
    assert.deepEqual(statuses.sort(),[200,409]);
  });
  await check('VOL-01','Quatre cycles indépendants sur différentes matières dans la même base',async()=>{
    for(const m of materials.slice(0,4)){
      const bc=await createBC(m,6);await approveBC(bc);
      const {receipt}=await receive(bc,6);
      const inv=await post('finance',I,invoice(bc.order.supplierId,receipt.id,6));
      await patch('finance2',I+'/'+inv.id,{action:'approve'});
      await patch('finance2',I+'/'+inv.id,{action:'payment',reference:'VOL-'+label(),amount:60});
    }
  });

  await month('2027-04-12');
  await check('O2C-SETTLE','Solde clôturé et paiement répété refusé',()=>o2c.settle(date));
  await check('BC-03','Clôture du reliquat BC puis DA, après livraison partielle',async()=>{
    const bc=await createBC(m1,10);await approveBC(bc);await receive(bc,3);
    await patch('approver',P+'/'+bc.d.id,{action:'close',reason},[409]);
    await patch('approver',B+'/'+bc.order.id,{action:'close',reason});
    assert.equal((await patch('approver',P+'/'+bc.d.id,{action:'close',reason})).purchase.status,'closed');
  });
  await check('STK-01','Sortie physique, entrée hors BC et ajustement direct interdits',async()=>{
    const lot=db.prepare("SELECT id,materialId,qty FROM StockLot WHERE status='available' AND materialId=? AND qty>=2 LIMIT 1").get(m1.id);
    const input={materialId:lot.materialId,stockLotId:lot.id,qty:1,type:'out',reason};
    await post('buyer','/api/movements',input,[403]);
    await post('inventory','/api/movements',{...input,type:'in'},[403]);
    await post('inventory','/api/movements',{...input,type:'adjust'},[403]);
    await post('inventory','/api/movements',input);
    await post('inventory','/api/movements',{...input,qty:lot.qty+1},[409]);
  });
  await check('FIN-04','Avoir après paiement et enregistrement du remboursement',async()=>{
    const inv=db.prepare("SELECT id FROM SupplierInvoice WHERE status='paid' AND totalAmount=60 ORDER BY id DESC LIMIT 1").get();
    assert(inv);
    const credit=(await post('finance',F,{action:'refund-credit',invoiceId:inv.id,amount:10,reason})).result;
    const refund=(await post('finance2',F,{action:'approve-credit',creditId:credit.id})).result;
    // AUDIT P5.15.27-B (AN-FIN-04) : quatre-yeux étendu — ni le préparateur
    // ni l'approbateur de l'avoir ne peuvent solder le remboursement. Le
    // règlement exige un TROISIÈME compte finance (finance3).
    await post('finance',F,{action:'settle-refund',refundId:refund.id,method:'bank',reference:'REM-SELF-'+label()},[409]);
    await post('finance2',F,{action:'settle-refund',refundId:refund.id,method:'bank',reference:'REM-APPROVER-'+label()},[409]);
    await post('finance3',F,{action:'settle-refund',refundId:refund.id,method:'bank',reference:'REM-'+label()});
    await post('finance3',F,{action:'settle-refund',refundId:refund.id,method:'bank',reference:'REM-DUP-'+label()},[409]);
    assert.equal(db.prepare('SELECT status FROM SupplierRefund WHERE id=?').get(refund.id).status,'refunded');
  });
  await check('FOU-03','Fournisseur désactivé après le projet de BC, refus et réactivation',async()=>{
    const bc=await createBC(m2);
    await patch('buyer','/api/suppliers',{supplierId:bc.order.supplierId,active:false});
    await patch('approver',B+'/'+bc.order.id,{action:'approve'},[409]);
    await patch('buyer','/api/suppliers',{supplierId:bc.order.supplierId,active:true});
    await approveBC(bc);
  });
  await check('CON-02','Contrat approuvé puis révoqué avant confirmation du BC',async()=>{
    const d=await approveDa(await da(m2));
    const supplierId=m2.suppliers[0];
    const agreement=(await post('buyer',S,{action:'agreement',supplierId,materialId:m2.id,contractRef:'CONTRAT-'+label(),documentRef:'Contrat synthétique',unitPrice:10,validFrom:date,validUntil:datePlus(20)})).result;
    await post('buyer',S,{action:'approveAgreement',agreementId:agreement.id},[409]);
    await post('approver',S,{action:'approveAgreement',agreementId:agreement.id});
    await post('buyer',B,{supplierId,lines:[{requestLineId:d.lines[0].id,qty:10,unitPrice:10,sourceType:'CONTRACT',sourceId:agreement.id}]},[409]);
    const rfq=await consult(d,m2,10);
    const plan=(await post('buyer',A,{action:'propose',rfqId:rfq.id,reason,allocations:[{sourceType:'CONTRACT',sourceId:agreement.id,qty:10}]})).result.planId;
    await post('approver',A,{action:'approve',planId:plan});
    const [order]=(await post('buyer',A,{action:'createDraftOrders',planId:plan})).result.orders;
    await post('approver',S,{action:'revokeAgreement',agreementId:agreement.id,reason});
    await patch('approver',B+'/'+order.id,{action:'approve'},[409]);
  });
  await check('FIN-05','Litige de délai et résolution journalisée',async()=>{
    const order=db.prepare('SELECT id,supplierId FROM SupplierOrder ORDER BY id DESC LIMIT 1').get();
    const dispute=(await post('finance',F,{action:'dispute',supplierId:order.supplierId,entityType:'SupplierOrder',entityId:order.id,category:'delivery',reason})).result;
    await post('finance2',F,{action:'resolve',disputeId:dispute.id,resolution:reason});
    assert.equal(db.prepare('SELECT status FROM SupplierDispute WHERE id=?').get(dispute.id).status,'resolved');
  });
  await check('FIN-03','Rapprochement des factures, soldes et écritures cumulées',async()=>{
    const finances=await get('finance',F);
    assert(finances.balances.some(x=>x.status==='paid'));
    await api('sales','GET',I,null,[403]);
    const currencies=db.prepare('SELECT DISTINCT currency FROM SupplierInvoice').all();
    assert.deepEqual(currencies.map(x=>x.currency),['MAD']);
  });
  await check('FIN-EXPORT','Export comptable positif, colonnes et totaux par facture',async()=>{
    const {raw}=await api('finance','GET','/api/p2p/accounting-export');
    // The exporter always quotes cells and doubles embedded quotes.
    const records=raw.replace(/^\uFEFF/,'').split('\r\n').map(line=>{
      const cells=[];let value='',quoted=false;
      for(let i=0;i<line.length;i++){
        const c=line[i];
        if(c==='"'){
          if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;
        }else if(c===';'&&!quoted){cells.push(value);value='';}else value+=c;
      }
      assert(!quoted,'CSV quote closed');cells.push(value);return cells;
    });
    assert(records.every(row=>row.length===16));
    const totals=new Map();
    for(const row of records.slice(1)){
      const key=row[0]+'|'+row[1];
      totals.set(key,(totals.get(key)||0)+Math.round(Number(row[14])*100));
    }
    for(const invoice of db.prepare('SELECT i.invoiceNumber,i.totalAmount,s.name FROM SupplierInvoice i JOIN Supplier s ON s.id=i.supplierId').all()){
      assert.equal(totals.get(invoice.name+'|'+invoice.invoiceNumber),Math.round(Number(invoice.totalAmount)*100));
    }
    if(artifacts)writeFileSync(join(artifacts,'export-comptable.csv'),raw);
    await api('sales','GET','/api/p2p/accounting-export',null,[403]);
  });
  await check('VOL-02','Accumulation de 121 DA et vérification au-delà de la première page',async()=>{
    const old=await da(m2,2);
    for(let i=0;i<120;i++){
      const d=await da(m3,1);
      await patch('approver',P+'/'+d.id,{action:'cancel',reason});
    }
    const history=await get('buyer','/api/materials/da-followup');
    assert(history.pagination.hasMore);
    const active=await get('buyer','/api/materials/da-followup?scope=open');
    assert(active.byMaterial[m2.id].history.some(x=>x.id===old.id));
  });
  for(const [id,path] of [['MAT','/api/materials/da-followup?scope=open'],['SRC',S],['INV',I],['FIN',F],['AWD',C]]) {
    await check('RBAC-'+id,'Lecture ventes refusée sur '+path,async()=>{
      await api('sales','GET',path,null,[403]);
    });
  }
  await check('DA-04','Limites de saisie et révision directe d’une DA approuvée',async()=>{
    for(const qty of [0,-1,1000001,0.0001]){
      await post('buyer',P,{lines:[{materialId:m2.id,qty}]},[400]);
    }
    const d=await approveDa(await da(m2));
    await patch('approver',P+'/'+d.id,{action:'advance'},[409]);
    await patch('approver',P+'/'+d.id,{action:'decide-lines',decisions:[{lineId:d.lines[0].id,decision:'approve'}]},[409]);
    await patch('approver',P+'/'+d.id,{action:'edit',lines:[{qty:999}]},[400]);
  });
  await check('DATA-01' ,'Intégrité, stock, emplacements et traçabilité finale',async()=>{
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    const drift=db.prepare(`SELECT m.id FROM Material m WHERE ABS(m.stockQty-COALESCE((SELECT SUM(qty) FROM StockLot WHERE materialId=m.id AND status='available'),0))>0.000001`).all();
    assert.deepEqual(drift,[]);
    const placements=db.prepare(`SELECT l.id FROM StockLot l WHERE ABS(l.qty-COALESCE((SELECT SUM(qty) FROM StockPlacement WHERE stockLotId=l.id),0))>0.000001`).all();
    assert.deepEqual(placements,[]);
  });
  await check('OPS-01','Sauvegarde SQLite cohérente et réouverture de la copie',async()=>{
    const {join}=require('node:path');
    const {DatabaseSync}=require('node:sqlite');
    const backup=join(temp,'restauration.db');
    db.exec("VACUUM INTO '"+backup.replace(/'/g,"''")+"'");
    const restored=new DatabaseSync(backup,{readOnly:true});
    try{
      assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      assert.equal(restored.prepare('SELECT count(*) n FROM PurchaseRequest').get().n,db.prepare('SELECT count(*) n FROM PurchaseRequest').get().n);
      assert.deepEqual(restored.prepare('SELECT id,stockQty FROM Material ORDER BY id').all(),db.prepare('SELECT id,stockQty FROM Material ORDER BY id').all());
    }finally{restored.close()}
  });
  checkpoint(date.slice(0,7));
  const totals=Object.fromEntries(['PurchaseRequest','Supplier','SupplierQualification','SupplierConsultation','SupplierQuoteOffer','SupplierAwardPlan','SupplierOrder','GoodsReceipt','SupplierInvoice','SupplierPayment','SupplierCreditNote','AuditEvent'].map(t=>[t,db.prepare('SELECT COUNT(*) n FROM '+t).get().n]));
  console.log('BILAN '+JSON.stringify({cases:results.length,failed,totals}));
  if(failed) process.exitCode=1;
};
