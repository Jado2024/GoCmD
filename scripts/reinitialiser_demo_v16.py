#!/usr/bin/env python3
"""Remise à zéro démonstration et simulation industrielle GoCmd V16.
Ne jamais exécuter sur une base réelle. Commande explicite: --apply --ack DEMO_ONLY.
Le catalogue et les référentiels sont préservés; tous les historiques transactionnels sont remplacés.
"""
import argparse, json, sqlite3, datetime as dt, pathlib, shutil, hashlib, math
from decimal import Decimal, ROUND_HALF_UP

HERE=pathlib.Path(__file__).resolve().parents[1]
DB=HERE/'db/custom.db'
D=dt.timezone.utc
T=lambda day: int(dt.datetime(2026,10,day,12,0,tzinfo=D).timestamp()*1000)
TRANSACTION_TABLES=[
 'SalesPayment','SalesCreditNote','SalesInvoiceLine','SalesInvoice','SalesDeliveryLine','SalesDelivery','SalesQuote','SalesDocCounter',
 'OrderPiece','OrderLine','Order', 'SupplierCreditNote','SupplierPayment','SupplierInvoiceLine','SupplierInvoice','SupplierDispute',
 'SupplierReturn','QualityInspection','StockCount','StockPlacement','Movement','StockLot','GoodsReceiptLine','GoodsReceipt',
 'SupplierDeliveryNote','SupplierDeliverySchedule','SupplierOrderRevision','SupplierOrderLine','SupplierOrder',
 'SupplierQuoteOffer','SupplierRFQ','SupplierQualification',
 'PurchaseReceiptLine','PurchaseReceipt','PurchaseRequestLine','PurchaseRequest','AuditEvent','StorageLocation','WarehouseSite'
]

def insert(c,table,**data):
 columns=','.join('"'+k+'"' for k in data)
 vals=','.join('?' for _ in data)
 cur=c.execute(f'INSERT INTO "{table}" ({columns}) VALUES ({vals})',list(data.values()))
 return cur.lastrowid

def audit(c,actor,action,entity,eid,detail,day=24):
 return insert(c,'AuditEvent',actor=actor,action=action,entity=entity,entityId=str(eid),details=json.dumps({'simulation':True,**detail},ensure_ascii=False),createdAt=T(day))

def getmat(c,mid):
 return c.execute('SELECT id,ref,name,unit,unitPrice,stockQty,averageCost FROM Material WHERE id=?',(mid,)).fetchone()

def movement(c,idx,mid,lot,qty,typ,reason,document,day,opening=False):
 r=insert(c,'Movement',ref=f'MVT-2026-{idx:04d}',type=typ,materialId=mid,stockLotId=lot,qty=abs(qty),unit=getmat(c,mid)['unit'],signedQty=qty,reason=reason,document=document,operator='demo_stock',createdAt=T(day),isArchived=0,isOpeningBalance=int(opening))
 audit(c,'demo_stock','STOCK_OPENING' if opening else 'STOCK_MOVEMENT','Movement',r,{'qty':qty,'lotId':lot,'document':document},day)
 return r

def demo(c):
 c.row_factory=sqlite3.Row
 c.execute('PRAGMA foreign_keys=ON')
 before={t:c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in TRANSACTION_TABLES}
 original_materials=[dict(x) for x in c.execute('SELECT * FROM Material ORDER BY id')]
 baseline=json.loads((HERE/'db/demo_baseline_55.json').read_text(encoding='utf-8'))
 basemap={r['id']:r for r in baseline['items']}
 for m in original_materials:
  if m['id'] not in basemap or basemap[m['id']]['ref']!=m['ref']:raise ValueError('Référentiel matières différent du jeu DEMO validé')
  m['stockQty']=basemap[m['id']]['qty']
  c.execute('UPDATE Material SET stockQty=? WHERE id=?',(m['stockQty'],m['id']))
 if len(original_materials)!=55: raise ValueError('Base de démonstration attendue: 55 matières')
 products=c.execute('SELECT COUNT(*) FROM Product').fetchone()[0]
 assert products >= 30, f'Catalogue de simulation insuffisant: {products}'
 for table in TRANSACTION_TABLES:
  c.execute(f'DELETE FROM "{table}"')
  c.execute('DELETE FROM sqlite_sequence WHERE name=?',(table,))
 # Recréation des emplacements - aucune mention de stock legacy.
 # The live API routes every unassigned receipt to DEFAULT/A_AFFECTER.
 # Seed it through the same database contract; SQL-only receipts must not hide missing operational prerequisites.
 default_wh=insert(c,'WarehouseSite',code='DEFAULT',name='Réceptions — affectation en attente (simulation)',active=1)
 insert(c,'StorageLocation',warehouseId=default_wh,code='A_AFFECTER',name='Stock réceptionné à affecter',status='active')
 wh=insert(c,'WarehouseSite',code='SODEPI-DEMO',name='Usine SODEPI — données de simulation',active=1)
 loc_mp=insert(c,'StorageLocation',warehouseId=wh,code='MP-A',name='Zone matières premières disponibles',status='active')
 loc_q=insert(c,'StorageLocation',warehouseId=wh,code='QC-B',name='Zone contrôle qualité et quarantaine',status='active')
 loc_exp=insert(c,'StorageLocation',warehouseId=wh,code='MP-C',name='Zone matières de production',status='active')
 # Hypothèse explicite: les quantités initiales sont réputées contrôlées uniquement POUR SIMULATION.
 for m in original_materials:
  mid=m['id'];qty=round(m['stockQty'],6)
  assert qty>=0
  lot=insert(c,'StockLot',materialId=mid,lotCode=f'SIM-OUVERTURE-{mid:03}',status='available',qty=qty,
          supplierId=None,receiptLineId=None,provenanceKey='DEMO-INIT-2026',receivedAt=T(20),expiresAt=None)
  if qty>0: insert(c,'StockPlacement',stockLotId=lot,locationId=loc_mp,qty=qty)
  movement(c,300+mid,mid,lot,qty,'in','Stock initial réputé validé pour simulation uniquement','SIM-INVENTAIRE-INITIAL',20,True)
  c.execute('UPDATE Material SET averageCost=? WHERE id=?',(str(m['unitPrice']),mid))
 audit(c,'demo_admin','DEMO_DATASET_RESET','Database','SIM-2026',{'catalogueProducts':products,'materials':55,'oldHistoryDiscarded':True},20)
 # Qualification fournisseurs et sourcing RFQ.
 for sid in range(1,8):
  q=insert(c,'SupplierQualification',supplierId=sid,status='approved',score=85+sid,note='Qualification fictive pour essais',reviewedBy='demo_approver',reviewedAt=T(21),expiresAt=T(31))
  audit(c,'demo_approver','SUPPLIER_QUALIFIED','SupplierQualification',q,{'supplierId':sid},21)
 c.execute('INSERT OR IGNORE INTO SupplierMaterial(supplierId,materialId,unitPrice,leadTimeDays,preferred,purchaseUnit,unitsPerPurchase) VALUES(1,1,27.5,4,0,?,1)',(getmat(c,1)['unit'],))
 rfq=insert(c,'SupplierRFQ',ref='RFQ-2026-00001',materialId=1,requestLineId=None,qty=80.,unit=getmat(c,1)['unit'],targetDate=T(30),deadline=T(23),status='awarded',createdBy='demo_buyer',createdAt=T(21))
 for supplier,price,chosen in ((2,'28',0),(1,'27.5',1)):
  o=insert(c,'SupplierQuoteOffer',rfqId=rfq,supplierId=supplier,unitPrice=price,qty=80,currency='MAD',leadTimeDays=4,paymentTerms='30 jours démo',note='Offre fictive',chosen=chosen,createdAt=T(21))
  audit(c,'demo_buyer','SUPPLIER_OFFER_RECEIVED','SupplierQuoteOffer',o,{'rfqId':rfq},21)
 audit(c,'demo_approver','SUPPLIER_RFQ_AWARDED','SupplierRFQ',rfq,{'chosenSupplierId':1},22)
 # DA - une DA répartie sur deux fournisseurs + une réception partielle, une complète et une attente.
 PR=[(1,1,80,'partial'),(2,2,100,'partial'),(3,3,100,'received'),(4,4,30,'pending')]
 requestlines={}
 for rid,mid,qty,status in PR:
  pr=insert(c,'PurchaseRequest',ref=f'DA-2026-{rid+300:04}',status=status,supplier=None,expectedDate=T(31),
    note=f'DA fictive V15 — {getmat(c,mid)["name"]}',createdAt=T(22),createdBy='demo_buyer',approvedBy=None if status=='pending' else 'demo_approver',approvedAt=None if status=='pending' else T(23))
  pl=insert(c,'PurchaseRequestLine',requestId=pr,materialId=mid,qty=qty,unitPrice=getmat(c,mid)['unitPrice'],receivedQty=0)
  requestlines[rid]=(pr,pl)
  audit(c,'demo_buyer','PURCHASE_REQUEST_CREATED','PurchaseRequest',pr,{'qty':qty,'materialId':mid},22)
  if status!='pending':audit(c,'demo_approver','PURCHASE_REQUEST_APPROVED','PurchaseRequest',pr,{},23)
 orderspec=[(1,2,1,50,28.,'partial'),(2,1,1,30,27.5,'received'),(3,7,2,100,22.,'partial'),(4,3,3,100,0.8,'received')]
 bc_line={}
 for i,supplier,req,qty,price,status in orderspec:
  mid=PR[req-1][1]
  po=insert(c,'SupplierOrder',ref=f'BC-2026-{i:05}',supplierId=supplier,status=status,expectedDate=T(30),
      note='Commande de simulation autonome GoCmd',createdAt=T(23),createdBy='demo_buyer',approvedBy='demo_approver')
  line=insert(c,'SupplierOrderLine',orderId=po,materialId=mid,requestLineId=requestlines[req][1],qty=qty,
       receivedQty=0,unitPrice=price,purchaseQty=qty,purchaseUnit=getmat(c,mid)['unit'],conversionFactor=1)
  bc_line[i]=(po,line)
  audit(c,'demo_buyer','SUPPLIER_ORDER_CREATED','SupplierOrder',po,{'qty':qty,'supplierId':supplier},23)
  audit(c,'demo_approver','SUPPLIER_ORDER_APPROVED','SupplierOrder',po,{},24)
  sched=insert(c,'SupplierDeliverySchedule',orderId=po,targetDate=T(30),plannedQty=qty,note='Planning de livraison fictif',status='confirmed',actor='demo_buyer',createdAt=T(24))
  audit(c,'demo_buyer','SUPPLIER_DELIVERY_SCHEDULED','SupplierDeliverySchedule',sched,{'BC':po},24)
 # Avenant documenté sans changement de quantités (révision d'une date fournisseur).
 revision=insert(c,'SupplierOrderRevision',orderId=bc_line[2][0],revision=1,
       previousSnapshot=json.dumps({'expectedDate':'2026-10-29'}),newSnapshot=json.dumps({'expectedDate':'2026-10-30'}),
       reason='Report de livraison fournisseur — exercice de simulation',actor='demo_approver',createdAt=T(24))
 audit(c,'demo_approver','SUPPLIER_ORDER_REVISED','SupplierOrderRevision',revision,{'orderId':bc_line[2][0]},24)
 # BL fournisseur, BR et lots, la quarantaine ne compte PAS dans le stock disponible.
 receiptlines={};receiptlots={};in_idx=356
 recspec=[(1,45,5,25),(2,30,0,26),(3,58,2,27),(4,100,0,28)]
 for idx,accepted,rejected,day in recspec:
  po,pol=bc_line[idx]; supplier=orderspec[idx-1][1];mid=orderspec[idx-1][2]
  bl=insert(c,'SupplierDeliveryNote',supplierId=supplier,reference=f'BL-DEMO-{idx:03}',createdAt=T(day))
  br=insert(c,'GoodsReceipt',ref=f'BR-2026-{idx:05}',supplierOrderId=po,deliveryRef=f'BL-DEMO-{idx:03}',
        operator='demo_receiver',note='Réception simulée',deliveryNoteId=bl,createdAt=T(day))
  brl=insert(c,'GoodsReceiptLine',goodsReceiptId=br,supplierOrderLineId=pol,acceptedQty=accepted,rejectedQty=rejected,returnedQty=0,lot=f'LOT-DEMO-{idx:03}',movementId=None)
  receiptlines[idx]=brl
  lot=insert(c,'StockLot',materialId=mid,lotCode=f'LOT-DEMO-{idx:03}',status='available',qty=accepted,
        supplierId=supplier,receiptLineId=brl,provenanceKey=f'BRL-{brl}',receivedAt=T(day),expiresAt=None)
  receiptlots[idx]=lot
  insert(c,'StockPlacement',stockLotId=lot,locationId=loc_mp,qty=accepted)
  mv=movement(c,in_idx,mid,lot,accepted,'in','Réception BC fournisseur',f'BR-2026-{idx:05}',day)
  in_idx+=1
  c.execute('UPDATE GoodsReceiptLine SET movementId=? WHERE id=?',(mv,brl))
  if rejected:
   qlot=insert(c,'StockLot',materialId=mid,lotCode=f'LOT-DEMO-{idx:03}',status='quarantine',qty=rejected,
         supplierId=supplier,receiptLineId=brl,provenanceKey=f'BRL-{brl}',receivedAt=T(day),expiresAt=None)
   insert(c,'StockPlacement',stockLotId=qlot,locationId=loc_q,qty=rejected)
   audit(c,'demo_quality','QUALITY_QUARANTINE','StockLot',qlot,{'qty':rejected,'BR':br},day)
  c.execute('UPDATE SupplierOrderLine SET receivedQty=receivedQty+? WHERE id=?',(accepted,pol))
  c.execute('UPDATE PurchaseRequestLine SET receivedQty=receivedQty+? WHERE id=?',(accepted,requestlines[orderspec[idx-1][2]][1]))
  original=float(getmat(c,mid)['stockQty']);oldavg=float(getmat(c,mid)['averageCost'] or getmat(c,mid)['unitPrice']);price=orderspec[idx-1][4]
  newavg=(original*oldavg+accepted*price)/(original+accepted) if original+accepted else price
  c.execute('UPDATE Material SET stockQty=?,averageCost=? WHERE id=?',(round(original+accepted,6),str(round(newavg,6)),mid))
  audit(c,'demo_receiver','GOODS_RECEIPT_POSTED','GoodsReceipt',br,{'acceptedQty':accepted,'rejectedQty':rejected,'blId':bl},day)
 # Libération QUALITÉ des 5 unités isolées sur BR1 : transfert de lot et mouvement signé.
 q1=c.execute("SELECT id FROM StockLot WHERE receiptLineId=? AND status='quarantine'",(receiptlines[1],)).fetchone()['id']
 inspection=insert(c,'QualityInspection',materialId=1,stockLotId=q1,decision='release',qty=5,
     reason='Contrôle qualité conforme — sortie de quarantaine de démonstration',actor='demo_quality',createdAt=T(28))
 c.execute('UPDATE StockLot SET qty=qty-5 WHERE id=?',(q1,))
 c.execute('UPDATE StockPlacement SET qty=qty-5 WHERE stockLotId=?',(q1,))
 c.execute('UPDATE StockLot SET qty=qty+5 WHERE id=?',(receiptlots[1],))
 c.execute('UPDATE StockPlacement SET qty=qty+5 WHERE stockLotId=?',(receiptlots[1],))
 c.execute('UPDATE GoodsReceiptLine SET acceptedQty=acceptedQty+5,rejectedQty=rejectedQty-5 WHERE id=?',(receiptlines[1],))
 c.execute('UPDATE SupplierOrderLine SET receivedQty=receivedQty+5 WHERE id=?',(bc_line[1][1],))
 c.execute('UPDATE PurchaseRequestLine SET receivedQty=receivedQty+5 WHERE id=?',(requestlines[1][1],))
 c.execute('UPDATE Material SET stockQty=stockQty+5 WHERE id=1')
 movement(c,360,1,receiptlots[1],5,'in','Libération qualité de quarantaine','BR-2026-00001',28)
 audit(c,'demo_quality','QUALITY_RELEASED','QualityInspection',inspection,{'qty':5,'lotId':q1,'availableLot':receiptlots[1]},28)
 # Retour de 3 unités acceptées, traçable sur le BR 1; écriture signée et lot retourné distinct.
 return_qty=3;mid=1; lot=receiptlots[1]
 ret=insert(c,'SupplierReturn',ref='RF-2026-00001',supplierId=2,stockLotId=lot,qty=return_qty,
       reason='Non-conformité constatée lors du contrôle secondaire — simulation',actor='demo_quality',creditExpected=1,createdAt=T(29))
 c.execute('UPDATE StockLot SET qty=qty-? WHERE id=?',(return_qty,lot))
 c.execute('UPDATE StockPlacement SET qty=qty-? WHERE stockLotId=?',(return_qty,lot))
 returned=insert(c,'StockLot',materialId=1,lotCode='LOT-DEMO-001',status='returned',qty=3,supplierId=2,
        receiptLineId=receiptlines[1],provenanceKey=f'BRL-{receiptlines[1]}',receivedAt=T(29),expiresAt=None)
 insert(c,'StockPlacement',stockLotId=returned,locationId=loc_q,qty=3)
 c.execute('UPDATE GoodsReceiptLine SET returnedQty=3 WHERE id=?',(receiptlines[1],))
 c.execute('UPDATE SupplierOrderLine SET receivedQty=receivedQty-3 WHERE id=?',(bc_line[1][1],))
 c.execute('UPDATE PurchaseRequestLine SET receivedQty=receivedQty-3 WHERE id=?',(requestlines[1][1],))
 c.execute('UPDATE Material SET stockQty=stockQty-3 WHERE id=1')
 movement(c,361,1,lot,-3,'out','Retour fournisseur après contrôle qualité','RF-2026-00001',29)
 audit(c,'demo_quality','SUPPLIER_RETURN','SupplierReturn',ret,{'qty':3,'lotId':lot},29)
 dispute=insert(c,'SupplierDispute',supplierId=7,entityType='GoodsReceipt',entityId=3,category='quality',
    reason='2 unités refusées en attente de décision fournisseur — simulation',status='open',resolution=None,
    openedBy='demo_quality',resolvedBy=None,openedAt=T(29),resolvedAt=None)
 audit(c,'demo_quality','SUPPLIER_DISPUTE_OPENED','SupplierDispute',dispute,{'receiptId':3},29)
 # Recalage statuts des DA ; borne commande conservée, reçu net < commandé après retours/rejets.
 for idx,(req,mid,qty,status) in enumerate(PR,1):
  if status=='pending':continue
  if idx==1: status='partial'
  elif idx==2: status='partial'
  elif idx==3: status='received'
  c.execute('UPDATE PurchaseRequest SET status=? WHERE id=?',(status,requestlines[idx][0]))
 # Factures fournisseurs, 3-way matching: montants = quantités nettes acceptées x prix BC.
 for i,quantity,day in [(1,47,29),(2,30,29),(3,58,30),(4,100,30)]:
  supplier=orderspec[i-1][1];price=orderspec[i-1][4]
  amount=Decimal(str(quantity))*Decimal(str(price))
  invoice=insert(c,'SupplierInvoice',supplierId=supplier,invoiceNumber=f'FACT-DEMO-{i:03}',invoiceDate=T(day),
      currency='MAD',status='paid' if i in (1,2,4) else 'approved',discrepancy=None,totalAmount=str(amount),freightAmount='0',
      createdBy='demo_finance_a',approvedBy='demo_finance_b',createdAt=T(day))
  insert(c,'SupplierInvoiceLine',invoiceId=invoice,orderLineId=bc_line[i][1],receiptLineId=receiptlines[i],qty=quantity,
     unitPrice=str(price),taxRate='0')
  audit(c,'demo_finance_b','SUPPLIER_INVOICE_APPROVED','SupplierInvoice',invoice,{'amount':str(amount)},day)
  if i in (1,2,4):
   amountpay=amount
   if i==2:
    credit=insert(c,'SupplierCreditNote',ref='AVF-2026-00001',supplierId=supplier,invoiceId=invoice,returnId=None,amount='5',reason='Remise commerciale démonstration',status='approved',actor='demo_finance_b',createdAt=T(day))
    audit(c,'demo_finance_b','SUPPLIER_CREDIT_APPROVED','SupplierCreditNote',credit,{'amount':'5'},day)
    amountpay-=Decimal(5)
   pay=insert(c,'SupplierPayment',invoiceId=invoice,amount=str(amountpay),reference=f'REG-FRN-2026-{i:03}',actor='demo_finance_c',paidAt=T(31))
   audit(c,'demo_finance_c','SUPPLIER_PAYMENT_RECORDED','SupplierPayment',pay,{'invoiceId':invoice,'amount':str(amountpay)},31)
 # Inventaire: écart de -2 uniquement sur le lot d'ouverture matière 2; compté puis approuvé par deux acteurs.
 opening2=c.execute("SELECT id,qty FROM StockLot WHERE materialId=2 AND provenanceKey='DEMO-INIT-2026'").fetchone()
 count=insert(c,'StockCount',lotId=opening2['id'],locationId=loc_mp,expectedQty=opening2['qty'],observedQty=opening2['qty']-2,
     reason='Simulation comptage d\'inventaire et double validation',status='approved',countedBy='demo_inventory',approvedBy='demo_approver',countedAt=T(30),approvedAt=T(31))
 c.execute('UPDATE StockLot SET qty=qty-2 WHERE id=?',(opening2['id'],))
 c.execute('UPDATE StockPlacement SET qty=qty-2 WHERE stockLotId=?',(opening2['id'],))
 c.execute('UPDATE Material SET stockQty=stockQty-2 WHERE id=2')
 movement(c,362,2,opening2['id'],-2,'adjust','Régularisation après inventaire simulé','INV-2026-00001',31)
 audit(c,'demo_approver','STOCK_COUNT_APPROVED','StockCount',count,{'delta':-2},31)
 # Sortie MP avec lot disponible, conforme au verrouillage des mouvements directs sans OF GoProd.
 mid=3;out_qty=6
 opening3=c.execute("SELECT id FROM StockLot WHERE materialId=3 AND provenanceKey='DEMO-INIT-2026'").fetchone()['id']
 c.execute('UPDATE StockLot SET qty=qty-? WHERE id=?',(out_qty,opening3))
 c.execute('UPDATE StockPlacement SET qty=qty-? WHERE stockLotId=?',(out_qty,opening3))
 c.execute('UPDATE Material SET stockQty=stockQty-? WHERE id=?',(out_qty,mid))
 movement(c,363,3,opening3,-out_qty,'out','Sortie matières simulée pour commande client','CMD-2026-0301',31)
 # Transfert interne de stock sans modification du solde global.
 opening1=c.execute("SELECT id FROM StockLot WHERE materialId=1 AND provenanceKey='DEMO-INIT-2026'").fetchone()['id']
 c.execute('UPDATE StockPlacement SET qty=qty-10 WHERE stockLotId=? AND locationId=?',(opening1,loc_mp))
 insert(c,'StockPlacement',stockLotId=opening1,locationId=loc_exp,qty=10)
 audit(c,'demo_inventory','STOCK_PLACEMENT_TRANSFER','StockLot',opening1,{'qty':10,'from':loc_mp,'to':loc_exp},31)
 # Ventes: devis->commande->pièces->BL->facture->avoir/paiement; un salon au ml et matelas u.
 lookup=lambda sku:c.execute('SELECT id FROM Product WHERE sku=?',(sku,)).fetchone()['id']
 sales=[
  (1,lookup('SIM-MAT-001'),'MATELAS',4.0,235.,'u',[1,1,1,1],'settled',1),
  (2,lookup('SIM-SAL-001'),'SALON',5.3,235.,'ml',[2.0,1.8,1.5],'partial',2),
  (3,lookup('SIM-BQ-001'),'BANQUETTE',3.0,290.,'ml',[1.2,1.8],'none',3),
  (4,lookup('SIM-GAU-001'),'GAUFRETTE',2.5,280.,'ml',[1.1,1.4],'paid',4),
  (5,lookup('SIM-PLA-001'),'PLAQUE_MOUSSE',2.0,390.,'u',[1,1],'paid',5),
 ]
 invoice_idx=0;bl_idx=0
 for no,product_id,family,total,price,unit,pieces,mode,client in sales:
  sub=int((Decimal(str(total))*Decimal(str(price))*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
  payload={'clientId':client,'priority':'normale','dueDate':dt.datetime.fromtimestamp(T(31)/1000,D).isoformat(),
           'note':'Simulation complète GoCmd V15','lines':[{'productId':product_id,'qty':total,'unitPrice':price}]}
  quote=insert(c,'SalesQuote',ref=f'DEV-2026-{no:05}',clientId=client,status='converted',payload=json.dumps(payload,ensure_ascii=False),
      subtotalCents=sub,expiresAt=None,createdBy='demo_sales',acceptedBy='demo_sales',acceptanceRef=f'ACC-DEMO-{no:03}',createdAt=T(23+no))
  audit(c,'demo_sales','SALES_QUOTE_CREATED','SalesQuote',quote,{'subtotalCents':sub},23+no)
  audit(c,'demo_sales','SALES_QUOTE_ACCEPTED','SalesQuote',quote,{'acceptanceRef':f'ACC-DEMO-{no:03}'},24+no)
  order=insert(c,'Order',ref=f'CMD-2026-{300+no:04}',clientId=client,status='shipped' if no==1 else 'ready',priority='normale',
      dueDate=T(31),note='Commande issue de devis simulé',createdAt=T(24+no),reviewComment='Contrôle commercial fictif',
      reviewedBy='demo_sales',reviewedAt=T(24+no),quoteId=quote,customerOrderNo=f'PO-CLIENT-DEMO-{no:03}')
  line=insert(c,'OrderLine',orderId=order,productId=product_id,qty=total,unit=unit,unitPrice=price,modelRef='DEMO',configRef='SIMULATION')
  pids=[]
  product=c.execute('SELECT length,width,height,name FROM Product WHERE id=?',(product_id,)).fetchone()
  for j,v in enumerate(pieces,1):
   linear=v if unit=='ml' else None
   gab='STD';billing='manual';shape='rectangle';extra=None
   if no==3:
    # Banquette DEMO : les 41 et 51 ont des côtés K/L exactement à 45°.
    # H est toujours la hauteur TOTALE, W calculé = H+(D+J)/2.
    gab='41' if j==1 else '51';billing='computed';shape='gabarit'
    shapeD=0.0 if gab=='41' else 1.0
    J=0.6 if gab=='41' else 0.9
    W=v;H=W-(shapeD+J)/2
    K=(W-shapeD)/math.sqrt(2);L=(W-J)/math.sqrt(2)
    extra=json.dumps({'J':J,**({'D':shapeD} if gab=='51' else {}),'K':K,'L':L,'H':H,'W':W,
      'distancePointesM':W,'angleHautKDegres':45,'angleBasLDegres':45,
      'projectionK':(W-shapeD)/2,'projectionL':(W-J)/2,
      'hauteurHautM':(W-shapeD)/2,'hauteurBasM':(W-J)/2,
      'profondeurBruteM':H,'longueurBruteIndicative':W},ensure_ascii=False)
   p=insert(c,'OrderPiece',code=f'ETQ-2026-{no:03}-{j:03}',orderLineId=line,salonNo=1,elementNo=j,partRef=f'L{j:02}',
      linearMeters=linear,gabaritCode=gab,billingMode=billing,sequence=j,label=product['name'],shape=shape,
      lengthCm=(v*100 if unit=='ml' else product['length']),widthCm=product['width'],heightCm=product['height'],
      dimensionsExtra=extra,note='Pièce fictive',status='pending',createdAt=T(25+no))
   pids.append(p)
  audit(c,'demo_sales','ORDER_CREATED','Order',order,{'quoteId':quote,'productId':product_id,'pieces':len(pids)},25+no)
  if no not in (1,2,4,5):continue
  chosen_groups=([pids[:2],pids[2:]] if no==1 else [pids[:2]])
  delivery_ids=[]
  for ids in chosen_groups:
   bl_idx+=1
   delivery=insert(c,'SalesDelivery',ref=f'BLC-2026-{bl_idx:05}',orderId=order,status='posted',note='BL client démo',createdBy='demo_sales',deliveredAt=T(28))
   qty=len(ids) if unit=='u' else round(sum(pieces[pids.index(x)] for x in ids),4)
   dl=insert(c,'SalesDeliveryLine',deliveryId=delivery,orderLineId=line,qty=qty,unit=unit,pieceIds=json.dumps(ids))
   delivery_ids.append((delivery,dl,qty))
   audit(c,'demo_sales','SALES_DELIVERY_POSTED','SalesDelivery',delivery,{'pieceIds':ids,'qty':qty},28)
  invoice_idx+=1
  billed_cents=sum(int((Decimal(str(qty))*Decimal(str(price))*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP)) for _,_,qty in delivery_ids)
  invoice=insert(c,'SalesInvoice',ref=f'FAC-2026-{invoice_idx:05}',orderId=order,clientId=client,status=mode,
      currency='MAD',taxRateBps=0,subtotalCents=billed_cents,taxCents=0,totalCents=billed_cents,
      createdBy='demo_finance_a',issuedAt=T(29))
  for delivery,dl,qty in delivery_ids:
   cents=int((Decimal(str(qty))*Decimal(str(price))*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
   insert(c,'SalesInvoiceLine',invoiceId=invoice,deliveryLineId=dl,qty=qty,unit=unit,unitPriceCents=int(price*100),amountCents=cents)
  audit(c,'demo_finance_a','SALES_INVOICE_ISSUED','SalesInvoice',invoice,{'totalCents':billed_cents,'BL':len(delivery_ids)},29)
  if no==1:
   credit=insert(c,'SalesCreditNote',invoiceId=invoice,ref='AVC-2026-00001',amountCents=14000,
         reason='Remise client après livraison — simulation',actor='demo_finance_b',createdAt=T(30))
   audit(c,'demo_finance_b','SALES_CREDIT_ISSUED','SalesCreditNote',credit,{'amountCents':14000},30)
   payment=insert(c,'SalesPayment',invoiceId=invoice,ref='ENC-2026-00001',amountCents=billed_cents-14000,method='virement',actor='demo_finance_b',paidAt=T(31))
   audit(c,'demo_finance_b','SALES_PAYMENT_RECORDED','SalesPayment',payment,{'amountCents':billed_cents-14000},31)
  else:
   paidAmount=50000 if no==2 else billed_cents
   payment=insert(c,'SalesPayment',invoiceId=invoice,ref=f'ENC-2026-{no:05}',amountCents=paidAmount,method='virement',actor='demo_finance_b',paidAt=T(31))
   audit(c,'demo_finance_b','SALES_PAYMENT_RECORDED','SalesPayment',payment,{'amountCents':paidAmount},31)
 # Devis rejeté (aucun BC/commande) et devis brouillon pour variété des statuts.
 for no,status in [(6,'rejected'),(7,'draft')]:
  id=insert(c,'SalesQuote',ref=f'DEV-2026-{no:05}',clientId=no,payload=json.dumps({'clientId':no,'priority':'normale','lines':[{'productId':lookup('SIM-MAT-001'),'qty':1,'unitPrice':1205}]}),
      status=status,subtotalCents=120500,createdBy='demo_sales',createdAt=T(30))
  audit(c,'demo_sales','SALES_QUOTE_'+status.upper(),'SalesQuote',id,{},30)
 for kind,n in [('DEV',7),('BLC',bl_idx),('FAC',invoice_idx),('AVC',1)]:insert(c,'SalesDocCounter',id=f'{kind}:2026',value=n)
 return {'before':before,'warehouse':wh,'baseline':55,'orders':5,'supplierOrders':4}


def check(c):
 c.row_factory=sqlite3.Row
 issues=[]
 fk=list(c.execute('PRAGMA foreign_key_check'))
 if fk:issues.append(f'Violation FK: {fk[:3]}')
 if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok':issues.append('Intégrité SQLite')
 # Aucune ancienne transaction ne doit survivre (refs toutes démo dans tables cible).
 for t,col,prefix in [('Movement','ref','MVT-2026-'),('Order','ref','CMD-2026-'),('PurchaseRequest','ref','DA-2026-')]:
  rows=c.execute(f'SELECT COUNT(*) FROM "{t}" WHERE "{col}" NOT LIKE ?',(prefix+'%',)).fetchone()[0]
  if rows:issues.append(f'{t}: {rows} références historiques')
 for row in c.execute('SELECT id,ref,stockQty FROM Material'):
  mid=row['id'];actual=float(row['stockQty'])
  journal=float(c.execute('SELECT COALESCE(SUM(signedQty),0) FROM Movement WHERE materialId=? AND isArchived=0',(mid,)).fetchone()[0])
  available=float(c.execute("SELECT COALESCE(SUM(qty),0) FROM StockLot WHERE materialId=? AND status='available'",(mid,)).fetchone()[0])
  if abs(actual-journal)>1e-4 or abs(actual-available)>1e-4:
   issues.append(f'Solde {row["ref"]}: material={actual},journal={journal},available={available}')
 for lot in c.execute('SELECT id,qty FROM StockLot'):
  placed=float(c.execute('SELECT COALESCE(SUM(qty),0) FROM StockPlacement WHERE stockLotId=?',(lot['id'],)).fetchone()[0])
  if abs(lot['qty']-placed)>1e-4:issues.append(f'Placement lot {lot["id"]}: {lot["qty"]} vs {placed}')
 for inv in c.execute('SELECT id,totalCents,status FROM SalesInvoice'):
  paid=int(c.execute('SELECT COALESCE(SUM(amountCents),0) FROM SalesPayment WHERE invoiceId=?',(inv['id'],)).fetchone()[0])
  credit=int(c.execute('SELECT COALESCE(SUM(amountCents),0) FROM SalesCreditNote WHERE invoiceId=?',(inv['id'],)).fetchone()[0])
  if paid+credit>inv['totalCents']:issues.append(f'Surpaiement facture client {inv["id"]}')
  if inv['status'] in ('paid','settled') and paid+credit!=inv['totalCents']:issues.append(f'Facture client non soldée {inv["id"]}')
 for inv in c.execute('SELECT id,totalAmount,status FROM SupplierInvoice'):
  paid=Decimal(str(c.execute('SELECT COALESCE(SUM(CAST(amount AS REAL)),0) FROM SupplierPayment WHERE invoiceId=?',(inv['id'],)).fetchone()[0]))
  credits=Decimal(str(c.execute('SELECT COALESCE(SUM(CAST(amount AS REAL)),0) FROM SupplierCreditNote WHERE invoiceId=?',(inv['id'],)).fetchone()[0]))
  if paid+credits>Decimal(str(inv['totalAmount']))+Decimal('0.0001'):issues.append(f'Surpaiement facture fournisseur {inv["id"]}')
  if inv['status']=='paid' and abs(paid+credits-Decimal(str(inv['totalAmount'])))>Decimal('0.0001'):issues.append(f'Facture fournisseur impayée {inv["id"]}')
 for line in c.execute('SELECT id,qty,receivedQty FROM SupplierOrderLine'):
  net=float(c.execute('SELECT COALESCE(SUM(acceptedQty-returnedQty),0) FROM GoodsReceiptLine WHERE supplierOrderLineId=?',(line['id'],)).fetchone()[0])
  if abs(net-line['receivedQty'])>1e-5 or net>line['qty']+1e-5:issues.append(f'BC ligne {line["id"]}: reçu incohérent')
 for line in c.execute('SELECT id,qty,receivedQty FROM PurchaseRequestLine'):
  total=float(c.execute('SELECT COALESCE(SUM(receivedQty),0) FROM SupplierOrderLine WHERE requestLineId=?',(line['id'],)).fetchone()[0])
  if abs(total-line['receivedQty'])>1e-5 or total>line['qty']+1e-5:issues.append(f'DA ligne {line["id"]}: reçu incohérent')
 for line in c.execute('SELECT id,qty FROM OrderLine'):
  pieces=c.execute('SELECT linearMeters FROM OrderPiece WHERE orderLineId=?',(line['id'],)).fetchall()
  unit=c.execute('SELECT unit FROM OrderLine WHERE id=?',(line['id'],)).fetchone()[0]
  qty=(len(pieces) if unit=='u' else sum(float(p['linearMeters'] or 0) for p in pieces))
  if abs(qty-line['qty'])>1e-4:issues.append(f'Commande ligne {line["id"]}: pièces != quantité')
 # Ne laisser aucune étiquette 41/51 avec un angle libre, ou W saisie contradictoire.
 for piece in c.execute("SELECT id,gabaritCode,dimensionsExtra,linearMeters,billingMode FROM OrderPiece WHERE gabaritCode IN ('41','51')"):
  x=json.loads(piece['dimensionsExtra'] or '{}');d=x.get('D',0) if piece['gabaritCode']=='51' else 0
  try:
   w=float(piece['linearMeters']);j=float(x['J']);k=float(x['K']);l=float(x['L']);h=float(x['H'])
   consistent=(abs(w-(h+(d+j)/2))<1e-6 and abs(k-(w-d)/math.sqrt(2))<0.005
             and abs(l-(w-j)/math.sqrt(2))<0.005 and x.get('angleHautKDegres')==45
             and x.get('angleBasLDegres')==45 and piece['billingMode']=='computed')
   if not consistent:issues.append(f'Gabarit {piece["gabaritCode"]} non conforme à 45° (pièce {piece["id"]})')
  except (TypeError,ValueError,KeyError):issues.append(f'Cotes manquantes gabarit {piece["id"]}')
 delivered=set()
 for dl in c.execute('SELECT id,pieceIds FROM SalesDeliveryLine'):
  for p in json.loads(dl['pieceIds']):
   if p in delivered:issues.append(f'Pièce {p} livrée deux fois')
   delivered.add(p)
 if c.execute("SELECT COUNT(*) FROM StockLot WHERE status='legacy_unverified'").fetchone()[0]:issues.append('Lots legacy')
 return issues

from catalogue_v16 import rebuild_sim_catalogue

def main():
 p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--ack',default='');p.add_argument('--db',type=pathlib.Path,default=DB)
 args=p.parse_args()
 if not args.apply or args.ack!='DEMO_ONLY':raise SystemExit('REFUS: utiliser --apply --ack DEMO_ONLY sur une copie de démonstration seulement.')
 path=args.db.resolve();path.parent.mkdir(parents=True,exist_ok=True)
 if path==DB.resolve():
  # garder la sauvegarde hors du zip pour ne pas réintroduire l'historique
  # Backup deliberately OUTSIDE the project folder, never reintegrated into deliverables.
  backup_dir=HERE.parent/'GoCmd_SAUVEGARDES_HORS_PROJET'
  backup_dir.mkdir(parents=True,exist_ok=True)
  backup=backup_dir/f'demo_avant_reset_{dt.datetime.now(D):%Y%m%dT%H%M%S%fZ}.db'
  src=sqlite3.connect(path);dest=sqlite3.connect(backup);src.backup(dest);src.close();dest.close()
 c=sqlite3.connect(path);c.row_factory=sqlite3.Row
 try:
  c.execute('PRAGMA foreign_keys=ON');c.execute('BEGIN IMMEDIATE');c.execute('PRAGMA defer_foreign_keys=ON')
  rebuild_sim_catalogue(c)
  result=demo(c)
  errors=check(c)
  if errors:raise RuntimeError('Audit données: '+repr(errors))
  c.commit()
  c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
  c.execute('VACUUM')
  print(json.dumps({'result':'SUCCESS','scenario':result,'fkViolations':0,'integrity':'ok','tables':{t:c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in TRANSACTION_TABLES}},ensure_ascii=False,indent=2))
 except: c.rollback();raise
 finally:c.close()
if __name__=='__main__':main()
