#!/usr/bin/env python3
"""Simulation SQL isolée et pédagogique d'un mois SODEPI; ne teste PAS les routes HTTP.
Utilise les véritables tables SQLite de GoCmd, mais les règles de flux sont un modèle de recette indépendant.
Ne jamais exécuter sur une base de production.
"""
import sqlite3, datetime as dt, json, csv, collections, os, sys, uuid
from pathlib import Path
DB=Path(os.environ.get('GOCMD_DB_FILE',str(Path(__file__).resolve().parent/'custom_mois_2026_11.db')))
OUT=DB.parent
assert DB.name=='custom_mois_2026_11.db' and DB.exists(),'Ne jamais executer sur une base non isolee'
c=sqlite3.connect(DB,timeout=30,isolation_level=None)
c.row_factory=sqlite3.Row
c.execute('PRAGMA foreign_keys=ON')
c.execute('PRAGMA busy_timeout=30000')
roles={x['username']:json.loads(x['roles_json']) for x in c.execute('SELECT username,roles_json FROM GoCmdUser')}
# AUDIT P5.15.27-B (AN-MOIS-01) : la base démo P5.15.23 livrée contient déjà
# 9 comptes nommés en français ; la recette vérifie la présence des 11 comptes
# demo_* qu'elle crée, sans exiger une base vierge (l'effectif total est 20).
assert len([u for u in roles if u.startswith('demo_')])==11, sorted(roles)
rights={'DA':['buyer'],'DA_APPROVE':['approver'],'RFQ':['buyer'],'BC':['buyer'],'BC_APPROVE':['approver'],
'BR':['receiver'],'QC':['quality'],'STOCK':['inventory'],'COUNT':['inventory'],'COUNT_APPROVE':['approver'],
'SALES':['sales'],'SALES_SPECIAL':['director'],'DELIVERY':['sales'],'AP_INVOICE':['finance'],'AP_PAYMENT':['finance'],
'AR_INVOICE':['finance'],'AR_PAYMENT':['finance'],'CREDIT':['finance'],'ADMIN':['admin']}
seq=collections.Counter();docs={}; counts=collections.Counter(); neg=[]

def stamp(day):
 day={6:9,18:17}.get(day,day) # Nov 6/18 jours feries marocains : travail reporte
 return f'2026-11-{day:02d}T10:00:00Z'
def ms(day):
 day={6:9,18:17}.get(day,day)
 return int(dt.datetime(2026,11,day,10,tzinfo=dt.timezone.utc).timestamp()*1000)
def ensure_role(actor,right):
 if not any(r in roles.get(actor,[]) for r in rights[right]):raise PermissionError(f'{actor} interdit: {right}')

def log(day,actor,action,result='PASS_SQL',detail='',doc=''):
 c.execute('INSERT INTO SimEvent(date,actor,action,result,document,detail) VALUES(?,?,?,?,?,?)',(stamp(day),actor,action,result,doc,detail))
 counts[actor]+=1

def audit(day,actor,action,entity,entityId,details={}):
 c.execute('INSERT INTO AuditEvent(actor,action,entity,entityId,details,createdAt) VALUES(?,?,?,?,?,?)',
  (actor,'SIM_'+action,entity,str(entityId),json.dumps(details,ensure_ascii=False),ms(day)))

def step(day,actor,right,action,fn,desc=''):
 ensure_role(actor,right)
 c.execute('BEGIN IMMEDIATE')
 try:
  res=fn()
  log(day,actor,action,detail=desc or str(res),doc=str(res) if res is not None else '')
  c.execute('COMMIT');return res
 except BaseException:
  c.execute('ROLLBACK');raise

def negative(day,actor,what,fn,expected_exc=(PermissionError,ValueError,sqlite3.IntegrityError)):
 c.execute('BEGIN IMMEDIATE')
 try:
  fn();c.execute('ROLLBACK');raise AssertionError('CONTROLE NON BLOQUANT: '+what)
 except expected_exc as e:
  c.execute('ROLLBACK');c.execute('INSERT INTO SimEvent(date,actor,action,result,document,detail) VALUES(?,?,?,?,?,?)',
   (stamp(day),actor,what,'REFUS_ATTENDU_SQL','',str(e)))
  neg.append((day,actor,what,type(e).__name__))
 except BaseException:
  c.execute('ROLLBACK');raise

def check_unit(matid,qty):
 r=c.execute('SELECT unit,isPurchasable,isManufactured,isSellable FROM Material WHERE id=?',(matid,)).fetchone()
 if not r or qty<=0:raise ValueError('quantité/matière invalide')
 if r['unit'] in ['bloc','plaque','pcs','rouleau','u','unite'] and abs(qty-round(qty))>0.0000001:raise ValueError('unité indivisible')
 if abs(qty*1000-round(qty*1000))>0.0000001:raise ValueError('precision max 3 decimales')
 return r

def create_da(day,material,qty):
 m=check_unit(material,qty)
 if not m['isPurchasable'] or m['isManufactured']:raise ValueError('ne pas acheter un produit fabriqué en interne')
 if c.execute('SELECT COUNT(*) FROM PurchaseRequest pr JOIN PurchaseRequestLine l ON l.requestId=pr.id WHERE l.materialId=? AND pr.status IN (\'pending\',\'approved\',\'partially_approved\',\'ordered\',\'partial\')',(material,)).fetchone()[0]:raise ValueError('DA active deja existante')
 seq['da']+=1;ref=f'SIM-DA-26-{seq["da"]:03d}'
 c.execute('INSERT INTO PurchaseRequest(ref,status,createdBy,note,createdAt) VALUES(?,?,?,?,?)',(ref,'pending','demo_buyer','Simulation NOV 2026',ms(day)))
 did=c.execute('SELECT last_insert_rowid()').fetchone()[0]; price=c.execute('SELECT unitPrice FROM Material WHERE id=?',(material,)).fetchone()[0]
 c.execute('INSERT INTO PurchaseRequestLine(requestId,materialId,qty,unitPrice,approvedQty,approvalDecision) VALUES(?,?,?,?,0,\'pending\')',(did,material,qty,price))
 audit(day,'demo_buyer','DA_CREATED','PurchaseRequest',did,{'ref':ref,'matid':material,'qty':qty});docs[ref]=did
 return ref

def approve_da(day,ref,approved,actor='demo_approver',reason=''):
 did=docs[ref]; q=c.execute('SELECT qty FROM PurchaseRequestLine WHERE requestId=?',(did,)).fetchone()['qty']
 creator=c.execute('SELECT createdBy FROM PurchaseRequest WHERE id=?',(did,)).fetchone()['createdBy']
 if actor==creator:raise PermissionError('contrôle 4 yeux auto approbation')
 if approved<0 or approved>q:raise ValueError('hors quantité demandée')
 if approved!=q and len(reason)<10:raise ValueError('motif obligatoire')
 decision='approved' if approved==q else 'reduced' if approved>0 else 'rejected'
 status='approved' if approved==q else 'partially_approved' if approved>0 else 'rejected'
 c.execute('UPDATE PurchaseRequest SET status=?,approvedBy=?,approvedAt=? WHERE id=? AND status=\'pending\'',(status,actor,ms(day),did))
 assert c.execute('SELECT changes()').fetchone()[0]==1
 c.execute('UPDATE PurchaseRequestLine SET approvedQty=?,approvalDecision=?,approvalReason=?,decisionBy=?,decisionAt=? WHERE requestId=?',(approved,decision,reason or None,actor,ms(day),did))
 audit(day,actor,'DA_APPROVED','PurchaseRequest',did,{'approved':approved,'reason':reason});return ref

def rfq(day,ref):
 did=docs[ref]; l=c.execute('SELECT * FROM PurchaseRequestLine WHERE requestId=?',(did,)).fetchone()
 assert l['approvedQty']>0
 seq['rfq']+=1;rr=f'SIM-RFQ-{seq["rfq"]:03d}'
 unit=c.execute('SELECT unit FROM Material WHERE id=?',(l['materialId'],)).fetchone()[0]
 c.execute('INSERT INTO SupplierRFQ(ref,materialId,requestLineId,qty,unit,status,createdBy,createdAt) VALUES(?,?,?,?,?,?,?,?)',
  (rr,l['materialId'],l['id'],l['approvedQty'],unit,'open','demo_buyer',ms(day)))
 rid=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 sup=c.execute('SELECT sm.supplierId,sm.unitPrice FROM SupplierMaterial sm JOIN Supplier s ON s.id=sm.supplierId WHERE sm.materialId=? AND s.active=1 ORDER BY sm.preferred DESC,sm.unitPrice LIMIT 1',(l['materialId'],)).fetchone();assert sup
 seq['consult']+=1;cr=f'SIM-CONS-{seq["consult"]:03d}'
 c.execute('INSERT INTO SupplierConsultation(ref,status,createdBy,createdAt) VALUES(?,?,?,?)',(cr,'prepared','demo_buyer',ms(day)));cid=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 c.execute('INSERT INTO SupplierConsultationLine(consultationId,rfqId) VALUES(?,?)',(cid,rid))
 c.execute('INSERT INTO SupplierConsultationRecipient(consultationId,supplierId) VALUES(?,?)',(cid,sup['supplierId']))
 c.execute('INSERT INTO SupplierQuoteOffer(rfqId,supplierId,unitPrice,qty,currency,leadTimeDays,note,chosen,createdAt,quoteRef,responseChannel,confirmationStatus) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  (rid,sup['supplierId'],sup['unitPrice'],l['approvedQty'],'MAD',5,'Offre fictive',1,ms(day),f'SIM-OFF-{seq["rfq"]:03d}','pdf','confirmed'))
 audit(day,'demo_buyer','RFQ_CREATED','SupplierRFQ',rid,{'ref':rr,'consultation':cr,'supplierId':sup['supplierId']});docs['RFQ:'+ref]=(rid,sup['supplierId'],sup['unitPrice'])
 return rr

def bc(day,ref):
 did=docs[ref];l=c.execute('SELECT * FROM PurchaseRequestLine WHERE requestId=?',(did,)).fetchone();rid,supplier,price=docs['RFQ:'+ref]
 assert l['approvedQty']>0
 seq['bc']+=1;bc_ref=f'SIM-BC-26-{seq["bc"]:03d}'
 c.execute('INSERT INTO SupplierOrder(ref,supplierId,status,createdBy,createdAt) VALUES(?,?,?,?,?)',(bc_ref,supplier,'draft','demo_buyer',ms(day)))
 bid=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 c.execute('INSERT INTO SupplierOrderLine(orderId,materialId,requestLineId,qty,receivedQty,unitPrice,conversionFactor) VALUES(?,?,?,?,?,?,1)',
  (bid,l['materialId'],l['id'],l['approvedQty'],0,price))
 audit(day,'demo_buyer','BC_DRAFT','SupplierOrder',bid,{'ref':bc_ref,'da':ref});docs['BC:'+ref]=bid
 return bc_ref

def confirm_bc(day,ref,actor='demo_approver'):
 bid=docs['BC:'+ref];buyer=c.execute('SELECT createdBy FROM SupplierOrder WHERE id=?',(bid,)).fetchone()['createdBy']
 if buyer==actor:raise PermissionError('approbateur = dernier rédacteur')
 c.execute('UPDATE SupplierOrder SET status=\'confirmed\',approvedBy=? WHERE id=? AND status=\'draft\'',(actor,bid));assert c.execute('SELECT changes()').fetchone()[0]==1
 c.execute('UPDATE PurchaseRequest SET status=\'ordered\' WHERE id=?',(docs[ref],))
 audit(day,actor,'BC_CONFIRMED','SupplierOrder',bid);return ref

def movement(day,actor,mid,qty,kind,lot,reason,document=None):
 seq['mov']+=1;rr=f'SIM-MOV-{seq["mov"]:04d}'
 unit=c.execute('SELECT unit FROM Material WHERE id=?',(mid,)).fetchone()['unit']
 c.execute('INSERT INTO Movement(ref,type,materialId,qty,unit,reason,document,operator,createdAt,signedQty,stockLotId) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
  (rr,kind,mid,abs(qty),unit,reason,document,actor,ms(day),qty,lot));return c.execute('SELECT last_insert_rowid()').fetchone()[0]

def receipt(day,ref,qty,rejected=0):
 bid=docs['BC:'+ref];l=c.execute('SELECT * FROM SupplierOrderLine WHERE orderId=?',(bid,)).fetchone();mid=l['materialId'];check_unit(mid,qty)
 assert qty+rejected<=l['qty']-l['receivedQty']+1e-8
 seq['br']+=1;rr=f'SIM-BR-26-{seq["br"]:03d}'
 c.execute('INSERT INTO GoodsReceipt(ref,supplierOrderId,deliveryRef,operator,createdAt) VALUES(?,?,?,?,?)',(rr,bid,f'SIM-BLFRN-{seq["br"]:03d}','demo_receiver',ms(day)))
 gid=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 c.execute('INSERT INTO GoodsReceiptLine(goodsReceiptId,supplierOrderLineId,acceptedQty,rejectedQty) VALUES(?,?,?,?)',(gid,l['id'],qty,rejected))
 grid=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 if qty>0:
  code=f'SIM-LOT-{mid:02d}-{seq["br"]:03d}'
  c.execute('INSERT INTO StockLot(materialId,lotCode,status,qty,supplierId,receiptLineId,provenanceKey,receivedAt) VALUES(?,?,?,?,?,?,?,?)',
   (mid,code,'available',qty,c.execute('SELECT supplierId FROM SupplierOrder WHERE id=?',(bid,)).fetchone()[0],grid,f'BRL-{grid}',ms(day)))
  lotid=c.execute('SELECT last_insert_rowid()').fetchone()[0]
  c.execute('INSERT INTO StockPlacement(stockLotId,locationId,qty) VALUES(?,?,?)',(lotid,1,qty))
  m=c.execute('SELECT stockQty,averageCost FROM Material WHERE id=?',(mid,)).fetchone()
  old=float(m['stockQty']);old_cost=float(m['averageCost'] or 0);cost=(old*old_cost+qty*l['unitPrice'])/(old+qty)
  c.execute('UPDATE Material SET stockQty=stockQty+?,averageCost=? WHERE id=?',(qty,round(cost,6),mid))
  mov=movement(day,'demo_receiver',mid,qty,'in',lotid,'Réception fournisseur simulée',rr)
  c.execute('UPDATE GoodsReceiptLine SET movementId=? WHERE id=?',(mov,grid))
  docs.setdefault('LOTS:'+ref,[]).append(lotid)
 if rejected:
  code=f'SIM-QC-{mid:02d}-{seq["br"]:03d}'
  c.execute('INSERT INTO StockLot(materialId,lotCode,status,qty,supplierId,receiptLineId,provenanceKey,receivedAt) VALUES(?,?,?,?,?,?,?,?)',
   (mid,code,'quarantine',rejected,c.execute('SELECT supplierId FROM SupplierOrder WHERE id=?',(bid,)).fetchone()[0],grid,f'BRL-{grid}',ms(day)))
  docs['QC:'+ref]=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 c.execute('UPDATE SupplierOrderLine SET receivedQty=receivedQty+? WHERE id=?',(qty,l['id']))
 total=c.execute('SELECT qty,receivedQty FROM SupplierOrderLine WHERE id=?',(l['id'],)).fetchone()
 status='received' if total['qty']<=total['receivedQty']+1e-8 else 'partial'
 c.execute('UPDATE SupplierOrder SET status=? WHERE id=?',(status,bid));c.execute('UPDATE PurchaseRequest SET status=? WHERE id=?',('received' if status=='received' else 'partial',docs[ref]))
 audit(day,'demo_receiver','BR_CREATED','GoodsReceipt',gid,{'ref':rr,'qty':qty,'rejected':rejected});docs['BR:'+ref]=docs.get('BR:'+ref,[])+[(gid,grid,qty)]
 return rr

def quality_reject(day,ref):
 lid=docs['QC:'+ref];l=c.execute('SELECT * FROM StockLot WHERE id=?',(lid,)).fetchone();qty=l['qty'];assert qty>0
 c.execute('INSERT INTO QualityInspection(materialId,stockLotId,decision,qty,reason,actor,createdAt) VALUES(?,?,?,?,?,?,?)',
  (l['materialId'],lid,'reject',qty,'Tissu non conforme — simulation','demo_quality',ms(day)))
 c.execute("UPDATE StockLot SET qty=0,status='returned' WHERE id=?",(lid,))
 seq['return']+=1;r=f'SIM-RET-{seq["return"]:03d}'
 c.execute('INSERT INTO SupplierReturn(ref,supplierId,stockLotId,qty,reason,actor,creditExpected,createdAt) VALUES(?,?,?,?,?,?,?,?)',
  (r,l['supplierId'],lid,qty,'Rejet qualité tissu','demo_quality',1,ms(day)))
 audit(day,'demo_quality','QC_REJECT','StockLot',lid,{'qty':qty,'return':r})
 return r

def stock_transfer(day,ref,qty,loc_a=1,loc_b=3):
 lotid=docs['LOTS:'+ref][0];mid=c.execute('SELECT materialId FROM StockLot WHERE id=?',(lotid,)).fetchone()[0]
 check_unit(mid,qty)
 a=c.execute('SELECT qty FROM StockPlacement WHERE stockLotId=? AND locationId=?',(lotid,loc_a)).fetchone();assert a and a['qty']>=qty
 c.execute('UPDATE StockPlacement SET qty=qty-? WHERE stockLotId=? AND locationId=?',(qty,lotid,loc_a))
 c.execute('INSERT INTO StockPlacement(stockLotId,locationId,qty) VALUES(?,?,?) ON CONFLICT(stockLotId,locationId) DO UPDATE SET qty=qty+excluded.qty',(lotid,loc_b,qty))
 audit(day,'demo_inventory','STOCK_TRANSFER','StockLot',lotid,{'qty':qty,'from':loc_a,'to':loc_b});return f'lot {lotid}'

def sale_order(day,client,items):
 seq['cmd']+=1;ref=f'SIM-CMD-26-{seq["cmd"]:03d}'
 c.execute('INSERT INTO "Order"(ref,clientId,status,priority,note,createdAt,fulfillmentStatus) VALUES(?,?,?,?,?,?,?)',
  (ref,client,'approved','normale','Simulation calendrier métier',ms(day),'open'))
 oid=c.execute('SELECT last_insert_rowid()').fetchone()[0];lineids=[]
 for mid,qty in items:
  m=check_unit(mid,qty)
  if not m['isSellable']:raise ValueError('article non vendable')
  p=c.execute('SELECT id,unit,unitPrice,unitsPerSale FROM Product WHERE materialId=? AND family=\'NEGOCE\' ORDER BY id DESC LIMIT 1',(mid,)).fetchone();assert p
  c.execute('INSERT INTO OrderLine(orderId,productId,qty,unit,unitPrice,stockUnit,stockUnitsPerSale) VALUES(?,?,?,?,?,?,?)',(oid,p['id'],qty,p['unit'],p['unitPrice'],c.execute('SELECT unit FROM Material WHERE id=?',(mid,)).fetchone()['unit'],p['unitsPerSale']))
  lineids.append((mid,c.execute('SELECT last_insert_rowid()').fetchone()[0],qty))
 audit(day,'demo_sales','CLIENT_ORDER','Order',oid,{'ref':ref,'lines':items});docs['CMD:'+ref]=(oid,lineids);return ref

def reserve(day,order_ref):
 oid,lines=docs['CMD:'+order_ref]
 for mid,lineid,qty in lines:
  remaining=qty
  for lot in c.execute("SELECT id,qty FROM StockLot WHERE materialId=? AND status='available' AND qty>0 ORDER BY id",(mid,)).fetchall():
   already=c.execute('SELECT coalesce(sum(qty),0) FROM SalesStockReservation WHERE stockLotId=?',(lot['id'],)).fetchone()[0]
   free=lot['qty']-already
   if free<=0:continue
   alloc=min(free,remaining)
   if alloc>0:
    c.execute('INSERT INTO SalesStockReservation(orderLineId,stockLotId,qty,createdBy,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',(lineid,lot['id'],alloc,'demo_sales',ms(day),ms(day)))
    remaining=round(remaining-alloc,6)
   if remaining<=0:break
  if remaining>0:raise ValueError(f'stock insuffisant pour {mid}, manque {remaining}')
 audit(day,'demo_sales','SALES_RESERVED','Order',oid,{'ref':order_ref});return order_ref

def delivery(day,order_ref,requested=None,requestKey=None):
 oid,lines=docs['CMD:'+order_ref];requestKey=requestKey or str(uuid.uuid5(uuid.NAMESPACE_DNS,f'{order_ref}-{seq["bl"]+1}'))
 if c.execute('SELECT id FROM SalesDelivery WHERE requestKey=?',(requestKey,)).fetchone():raise ValueError('idempotence: BL déjà enregistré')
 seq['bl']+=1;ref=f'SIM-BLC-{seq["bl"]:03d}'
 c.execute('INSERT INTO SalesDelivery(ref,orderId,status,createdBy,deliveredAt,requestKey,requestHash) VALUES(?,?,?,?,?,?,?)',
  (ref,oid,'posted','demo_sales',ms(day),requestKey,'SIMULATED_SQL_ONLY'))
 delivery_id=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 for mid,lineid,q in lines:
  qty=requested.get(mid,q) if requested else q
  delivered=c.execute('SELECT coalesce(sum(qty),0) FROM SalesDeliveryLine WHERE orderLineId=?',(lineid,)).fetchone()[0]
  qty=min(qty,round(q-delivered,3))
  if qty<=0:continue
  c.execute('INSERT INTO SalesDeliveryLine(deliveryId,orderLineId,qty,unit,pieceIds) VALUES(?,?,?,?,?)',(delivery_id,lineid,qty,c.execute('SELECT unit FROM Material WHERE id=?',(mid,)).fetchone()[0],'[]'))
  dlid=c.execute('SELECT last_insert_rowid()').fetchone()[0];still=qty
  res=c.execute('SELECT * FROM SalesStockReservation WHERE orderLineId=? ORDER BY id',(lineid,)).fetchall()
  for rr in res:
   consume=min(still,rr['qty'])
   if consume<=0:continue
   if abs(consume-rr['qty'])<1e-8:c.execute('DELETE FROM SalesStockReservation WHERE id=?',(rr['id'],))
   else:c.execute('UPDATE SalesStockReservation SET qty=qty-?,updatedAt=? WHERE id=?',(consume,ms(day),rr['id']))
   lotid=rr['stockLotId'];c.execute('UPDATE StockLot SET qty=qty-? WHERE id=?',(consume,lotid))
   # stock can be in several locations; reduce oldest placement first
   placeleft=consume
   for pl in c.execute('SELECT id,qty FROM StockPlacement WHERE stockLotId=? AND qty>0 ORDER BY locationId,id',(lotid,)).fetchall():
    d=min(placeleft,pl['qty']);c.execute('UPDATE StockPlacement SET qty=qty-? WHERE id=?',(d,pl['id']));placeleft=round(placeleft-d,6)
    if placeleft<=0:break
   assert placeleft<=0
   c.execute('UPDATE Material SET stockQty=stockQty-? WHERE id=?',(consume,mid))
   moveid=movement(day,'demo_sales',mid,-consume,'out',lotid,'BL client simulé',ref)
   c.execute('INSERT INTO SalesStockAllocation(deliveryLineId,stockLotId,movementId,qty,unit,createdAt) VALUES(?,?,?,?,?,?)',
    (dlid,lotid,moveid,consume,c.execute('SELECT unit FROM Material WHERE id=?',(mid,)).fetchone()[0],ms(day)))
   still=round(still-consume,6)
   if still<=0:break
  if still>0:raise ValueError('réservation insuffisante pour BL')
 audit(day,'demo_sales','DELIVERY_POSTED','SalesDelivery',delivery_id,{'ref':ref,'order':order_ref});docs['BL:'+order_ref]=docs.get('BL:'+order_ref,[])+[delivery_id]
 return ref

def ap_invoice(day,ref):
 bid=docs['BC:'+ref];sid=c.execute('SELECT supplierId FROM SupplierOrder WHERE id=?',(bid,)).fetchone()[0]
 lines=c.execute('SELECT gl.id,gl.acceptedQty,sol.id as orderline,sol.unitPrice FROM GoodsReceiptLine gl JOIN SupplierOrderLine sol ON sol.id=gl.supplierOrderLineId WHERE sol.orderId=?',(bid,)).fetchall()
 total=sum(x['acceptedQty']*x['unitPrice'] for x in lines)
 seq['apin']+=1;num=f'SIM-APINV-{seq["apin"]:03d}'
 c.execute('INSERT INTO SupplierInvoice(supplierId,invoiceNumber,invoiceDate,currency,status,totalAmount,createdBy,createdAt) VALUES(?,?,?,?,?,?,?,?)',
  (sid,num,ms(day),'MAD','draft',round(total,2),'demo_finance',ms(day)))
 iid=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 for l in lines:
  c.execute('INSERT INTO SupplierInvoiceLine(invoiceId,orderLineId,qty,unitPrice,taxRate,receiptLineId) VALUES(?,?,?,?,?,?)',
   (iid,l['orderline'],l['acceptedQty'],l['unitPrice'],0,l['id']))
 audit(day,'demo_finance','AP_INVOICE','SupplierInvoice',iid,{'totalMAD':total,'sourceBC':ref});docs['AP:'+ref]=iid;return num

def approve_ap_invoice(day,ref,actor='demo_finance_2'):
 iid=docs['AP:'+ref];invoice=c.execute('SELECT createdBy,status FROM SupplierInvoice WHERE id=?',(iid,)).fetchone()
 if invoice['createdBy']==actor:raise PermissionError('quatre yeux facture fournisseur')
 if invoice['status']!='draft':raise ValueError('facture plus en brouillon')
 c.execute("UPDATE SupplierInvoice SET status='approved',approvedBy=? WHERE id=?",(actor,iid))
 audit(day,actor,'AP_INVOICE_APPROVED','SupplierInvoice',iid)
 return iid

def ap_invoice_mismatch(ref,attemptQty):
 bid=docs['BC:'+ref]
 received=c.execute('SELECT coalesce(sum(gl.acceptedQty),0) FROM GoodsReceiptLine gl JOIN SupplierOrderLine ol ON ol.id=gl.supplierOrderLineId WHERE ol.orderId=?',(bid,)).fetchone()[0]
 if attemptQty>received+0.000001:raise ValueError('facture > reçu accepté : écart 3 voies')
 return True

def propose_special(day):
 row=c.execute('SELECT * FROM Product WHERE id=1').fetchone()
 cols=[x for x in row.keys() if x!='id'];data={x:row[x] for x in cols}
 data.update(sku='SIM-PROD-SPECIAL-01',name='Matelas spécifique client — simulation',model='SIM SPECIAL',unitPrice=600.0,status='pending_validation',specialNotes='Prix exceptionnel proposé pour une commande fictive.',specialPriceStatus='pending',specialPriceProposedBy='demo_sales',specialApprovedUnitPrice=None,specialPriceRevision=1,createdAt=ms(day))
 c.execute('INSERT INTO Product('+','.join('"'+x+'"' for x in cols)+') VALUES('+','.join('?' for _ in cols)+')',[data[x] for x in cols]); pid=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 audit(day,'demo_sales','SPECIAL_PRICE_PROPOSED','Product',pid,{'price':600});docs['SPECIAL']=pid
 return pid

def approve_special(day,actor='demo_director'):
 pid=docs['SPECIAL'];p=c.execute('SELECT specialPriceProposedBy,specialPriceStatus FROM Product WHERE id=?',(pid,)).fetchone()
 if p['specialPriceProposedBy']==actor:raise PermissionError('directeur et proposant doivent être distincts')
 if p['specialPriceStatus']!='pending':raise ValueError('pas en attente')
 c.execute("UPDATE Product SET specialPriceStatus='approved',specialApprovedUnitPrice=unitPrice,specialPriceApprovedBy=?,specialPriceApprovedAt=?,specialPriceDecisionReason='Visa prix special de simulation' WHERE id=?",(actor,ms(day),pid))
 audit(day,actor,'SPECIAL_PRICE_APPROVED','Product',pid)
 return pid

def draft_credit(day,oref,amount=10000):
 iid=docs['AR:'+oref];total=c.execute('SELECT totalCents FROM SalesInvoice WHERE id=?',(iid,)).fetchone()[0]
 paid=c.execute('SELECT coalesce(sum(amountCents),0) FROM SalesPayment WHERE invoiceId=?',(iid,)).fetchone()[0]
 existing=c.execute("SELECT coalesce(sum(amountCents),0) FROM SalesCreditNote WHERE invoiceId=? AND status IN ('draft','approved')",(iid,)).fetchone()[0]
 if amount<=0 or paid+existing+amount>total:raise ValueError('Avoir dépasse solde facturé')
 seq['credit']+=1;ref=f'SIM-AVOIR-{seq["credit"]:03d}'
 c.execute('INSERT INTO SalesCreditNote(invoiceId,ref,amountCents,reason,actor,createdAt,status) VALUES(?,?,?,?,?,?,?)',(iid,ref,amount,'Remise commerciale fictive','demo_finance',ms(day),'draft'))
 cid=c.execute('SELECT last_insert_rowid()').fetchone()[0];docs['CREDIT']=cid
 audit(day,'demo_finance','CREDIT_DRAFTED','SalesCreditNote',cid,{'cents':amount});return ref

def approve_credit(day,actor='demo_finance_2'):
 id=docs['CREDIT'];r=c.execute('SELECT actor,status FROM SalesCreditNote WHERE id=?',(id,)).fetchone()
 if r['actor']==actor:raise PermissionError('quatre yeux avoir client')
 if r['status']!='draft':raise ValueError('avoir déjà traité')
 c.execute("UPDATE SalesCreditNote SET status='approved',decisionActor=?,decidedAt=? WHERE id=?",(actor,ms(day),id))
 audit(day,actor,'CREDIT_APPROVED','SalesCreditNote',id);return id

def ap_payment(day,ref):
 iid=docs['AP:'+ref];r=c.execute('SELECT totalAmount FROM SupplierInvoice WHERE id=?',(iid,)).fetchone();amount=round(r['totalAmount']/2,2)
 seq['appay']+=1;payment=f'SIM-AP-PAY-{seq["appay"]:03d}'
 c.execute('INSERT INTO SupplierPayment(invoiceId,amount,reference,actor,paidAt) VALUES(?,?,?,?,?)',(iid,amount,payment,'demo_finance',ms(day)))
 c.execute('UPDATE SupplierInvoice SET status=\'partial\' WHERE id=?',(iid,))
 audit(day,'demo_finance','AP_PAYMENT','SupplierInvoice',iid,{'amountMAD':amount});return payment

def ar_invoice(day,oref):
 oid,lines=docs['CMD:'+oref];dls=c.execute('SELECT dl.id,dl.qty,ol.unitPrice FROM SalesDeliveryLine dl JOIN SalesDelivery d ON d.id=dl.deliveryId JOIN OrderLine ol ON ol.id=dl.orderLineId WHERE d.orderId=?',(oid,)).fetchall()
 total_cents=sum(round(x['qty']*x['unitPrice']*100) for x in dls)
 seq['arin']+=1;num=f'SIM-ARINV-{seq["arin"]:03d}'
 cid=c.execute('SELECT clientId FROM "Order" WHERE id=?',(oid,)).fetchone()[0]
 c.execute('INSERT INTO SalesInvoice(ref,orderId,clientId,status,currency,taxRateBps,subtotalCents,taxCents,totalCents,createdBy,issuedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
  (num,oid,cid,'issued','MAD',0,total_cents,0,total_cents,'demo_finance',ms(day)))
 iid=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 for dl in dls:
  c.execute('INSERT INTO SalesInvoiceLine(invoiceId,deliveryLineId,qty,unit,unitPriceCents,amountCents) VALUES(?,?,?,?,?,?)',
   (iid,dl['id'],dl['qty'],c.execute('SELECT unit FROM SalesDeliveryLine WHERE id=?',(dl['id'],)).fetchone()[0],round(dl['unitPrice']*100),round(dl['qty']*dl['unitPrice']*100)))
 audit(day,'demo_finance','AR_INVOICE','SalesInvoice',iid,{'totalCents':total_cents});docs['AR:'+oref]=iid;return num

def ar_payment(day,oref):
 iid=docs['AR:'+oref];cents=c.execute('SELECT totalCents FROM SalesInvoice WHERE id=?',(iid,)).fetchone()[0]
 seq['arpay']+=1;r=f'SIM-AR-PAY-{seq["arpay"]:03d}';amount=cents//2
 c.execute('INSERT INTO SalesPayment(invoiceId,ref,amountCents,method,actor,paidAt) VALUES(?,?,?,?,?,?)',
  (iid,r,amount,'virement','demo_finance',ms(day)))
 c.execute('UPDATE SalesInvoice SET status=\'partial\' WHERE id=?',(iid,))
 audit(day,'demo_finance','AR_PAYMENT','SalesInvoice',iid,{'paidCents':amount});return r

def inventory_use(day,mid,qty):
 m=check_unit(mid,qty);lots=c.execute("SELECT id,qty FROM StockLot WHERE materialId=? AND status='available' AND qty>0 ORDER BY id",(mid,)).fetchall();left=qty
 available=sum(l['qty']-c.execute('SELECT coalesce(sum(qty),0) FROM SalesStockReservation WHERE stockLotId=?',(l['id'],)).fetchone()[0] for l in lots)
 if available+0.000001<qty:raise ValueError('quantité indisponible / réservée')
 for l in lots:
  reserved=c.execute('SELECT coalesce(sum(qty),0) FROM SalesStockReservation WHERE stockLotId=?',(l['id'],)).fetchone()[0]
  take=min(left,l['qty']-reserved)
  if take<=0:continue
  c.execute('UPDATE StockLot SET qty=qty-? WHERE id=?',(take,l['id']))
  pl=c.execute('SELECT id,qty FROM StockPlacement WHERE stockLotId=? ORDER BY id',(l['id'],)).fetchone();assert pl and pl['qty']>=take
  c.execute('UPDATE StockPlacement SET qty=qty-? WHERE id=?',(take,pl['id']))
  c.execute('UPDATE Material SET stockQty=stockQty-? WHERE id=?',(take,mid))
  movement(day,'demo_inventory',mid,-take,'out',l['id'],'Consommation interne fictive',f'SIM-ATELIER-{day}')
  left=round(left-take,6)
  if left<=0:break
 if left>0:raise ValueError('quantité indisponible / réservée')
 audit(day,'demo_inventory','INTERNAL_ISSUE','Material',mid,{'qty':qty});return mid

def stock_count(day,lotid,observed):
 l=c.execute('SELECT * FROM StockLot WHERE id=?',(lotid,)).fetchone()
 if observed<0 or (l['qty']>0 and observed==l['qty']):raise ValueError('comptage non discordant')
 seq['count']+=1;c.execute('INSERT INTO StockCount(lotId,locationId,expectedQty,observedQty,reason,status,countedBy,countedAt) VALUES(?,?,?,?,?,?,?,?)',
  (lotid,1,l['qty'],observed,'Ecart physique simulé','pending','demo_inventory',ms(day)))
 cid=c.execute('SELECT last_insert_rowid()').fetchone()[0];audit(day,'demo_inventory','COUNT_SUBMITTED','StockCount',cid);docs['COUNT']=cid;return cid

def approve_count(day):
 cid=docs['COUNT'];p=c.execute('SELECT * FROM StockCount WHERE id=?',(cid,)).fetchone()
 if p['countedBy']=='demo_approver':raise PermissionError('4 yeux inventaire')
 diff=p['observedQty']-p['expectedQty'];l=c.execute('SELECT * FROM StockLot WHERE id=?',(p['lotId'],)).fetchone();mid=l['materialId']
 check_unit(mid,abs(diff))
 if c.execute('SELECT sum(qty) FROM SalesStockReservation WHERE stockLotId=?',(p['lotId'],)).fetchone()[0] or 0:raise ValueError('lot réservé comptage bloqué')
 c.execute('UPDATE StockLot SET qty=? WHERE id=?',(p['observedQty'],p['lotId']))
 c.execute('UPDATE StockPlacement SET qty=qty+? WHERE stockLotId=? AND locationId=1',(diff,p['lotId']))
 c.execute('UPDATE Material SET stockQty=stockQty+? WHERE id=?',(diff,mid))
 movement(day,'demo_approver',mid,diff,'adjustment',p['lotId'],'Comptage approuvé',f'COUNT:{cid}')
 c.execute("UPDATE StockCount SET status='approved',approvedBy='demo_approver',approvedAt=? WHERE id=?",(ms(day),cid))
 audit(day,'demo_approver','COUNT_APPROVED','StockCount',cid,{'delta':diff});return cid

# Create isolated simulation-only event table
c.execute('CREATE TABLE IF NOT EXISTS SimEvent(id INTEGER PRIMARY KEY,date TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,result TEXT NOT NULL,document TEXT,detail TEXT)')
assert c.execute('SELECT count(*) FROM SimEvent').fetchone()[0]==0,'Ne pas rejouer sur une base déjà simulée'

# A full calendar (21 working days). Documented SQL exercise, not an HTTP trace.
step(2,'demo_admin','ADMIN','ADMIN_ONBOARDING',lambda:'11 comptes fictifs / permissions par rôle')
step(2,'demo_buyer','DA','ANALYSER_BESOINS',lambda:'64 matières, 33 achetables sous seuil, 7 à fabriquer')
negative(2,'demo_buyer','AGGLO_DA_REFUSEE',lambda:create_da(2,19,2))
negative(2,'demo_buyer','FRACTION_BLOC_REFUSEE',lambda:create_da(2,3,0.5))
step(3,'demo_buyer','DA','DA_MOUSSE',lambda:create_da(3,3,8))
step(3,'demo_buyer','DA','DA_TISSU',lambda:create_da(3,27,120))
step(3,'demo_buyer','DA','DA_MERCERIE',lambda:create_da(3,50,1800))
step(4,'demo_buyer','DA','DA_COLLE',lambda:create_da(4,41,100))
step(4,'demo_buyer','DA','DA_FERMETURE',lambda:create_da(4,54,150))
step(4,'demo_buyer','DA','DA_FILM',lambda:create_da(4,58,20))
negative(5,'demo_buyer_approver','AUTO_APPROBATION_REFUSEE',lambda:(c.execute("UPDATE PurchaseRequest SET createdBy='demo_buyer_approver' WHERE id=?",(docs['SIM-DA-26-001'],)),approve_da(5,'SIM-DA-26-001',8,actor='demo_buyer_approver')))
negative(5,'demo_buyer','DA_DOUBLON_REFUSEE',lambda:create_da(5,3,8))
for i,qty,reason in [(1,8,''),(2,100,'Réduction au besoin réel confirmé'),(3,1500,'Réduction stock disponible attendu'),(4,100,''),(5,150,''),(6,0,'Réapprovisionnement suspendu pour contrôle')]:
 day=5 if i<=3 else 6
 step(day,'demo_approver','DA_APPROVE',('DA_REFUSEE' if i==6 else 'DA_DECISION'),lambda i=i,qty=qty,day=day,reason=reason:approve_da(day,f'SIM-DA-26-{i:03d}',qty,reason=reason))
for i,day in [(1,9),(2,9),(3,10),(4,10),(5,10)]:
 ref=f'SIM-DA-26-{i:03d}';step(day,'demo_buyer','RFQ','CONSULTER_FOURNISSEURS',lambda ref=ref,day=day:rfq(day,ref))
for i,day in [(1,11),(2,11),(3,11),(4,12),(5,12)]:
 ref=f'SIM-DA-26-{i:03d}';step(day,'demo_buyer','BC','PREPARER_BC',lambda ref=ref,day=day:bc(day,ref))
for i in range(1,6):
 ref=f'SIM-DA-26-{i:03d}';step(12,'demo_approver','BC_APPROVE','APPROUVER_BC',lambda ref=ref:confirm_bc(12,ref))
negative(12,'demo_buyer','RECEPTION_INTERDITE_ACHETEUR',lambda:ensure_role('demo_buyer','BR'))
step(13,'demo_receiver','BR','RECEPTION_MOUSSE_PARTIELLE',lambda:receipt(13,'SIM-DA-26-001',5))
step(13,'demo_receiver','BR','RECEPTION_TISSU_PARTIELLE_REJET',lambda:receipt(13,'SIM-DA-26-002',60,10))
step(13,'demo_receiver','BR','RECEPTION_FIL',lambda:receipt(13,'SIM-DA-26-003',1500))
step(13,'demo_receiver','BR','RECEPTION_COLLE',lambda:receipt(13,'SIM-DA-26-004',80))
step(13,'demo_receiver','BR','RECEPTION_ZIPS',lambda:receipt(13,'SIM-DA-26-005',150))
step(16,'demo_quality','QC','REJET_LOT_TISSU',lambda:quality_reject(16,'SIM-DA-26-002'))
step(16,'demo_inventory','STOCK','TRANSFERT_MOUSSE',lambda:stock_transfer(16,'SIM-DA-26-001',2))
step(16,'demo_inventory','STOCK','SORTIE_INTERNE_TISSU',lambda:inventory_use(16,25,6))
negative(16,'demo_inventory','SORTIE_SUR_STOCK_INEXISTANT',lambda:inventory_use(16,3,999))
step(17,'demo_receiver','BR','RECEPTION_MOUSSE_SOLDE',lambda:receipt(17,'SIM-DA-26-001',3))
step(17,'demo_receiver','BR','RECEPTION_TISSU_SOLDE',lambda:receipt(17,'SIM-DA-26-002',40))
step(17,'demo_receiver','BR','RECEPTION_COLLE_SOLDE',lambda:receipt(17,'SIM-DA-26-004',20))
step(18,'demo_sales','SALES','COMMANDE_CLIENT_MIXTE_1',lambda:sale_order(18,1,[(3,3),(27,20)]))
step(18,'demo_sales','SALES','COMMANDE_CLIENT_REVENTE_2',lambda:sale_order(18,2,[(3,2),(27,15)]))
step(18,'demo_sales','SALES','RESERVER_CMD_1',lambda:reserve(18,'SIM-CMD-26-001'))
step(18,'demo_sales','SALES','RESERVER_CMD_2',lambda:reserve(18,'SIM-CMD-26-002'))
negative(18,'demo_sales','SURRESEVATION_BLOC_REFUSEE',lambda:reserve(18,sale_order(18,3,[(3,6)]))) # SQL-controlled reservation refuses oversell
step(19,'demo_sales','DELIVERY','BL_PARTIEL_CMD_1',lambda:delivery(19,'SIM-CMD-26-001',{3:2,27:10},'00000000-0000-4000-8000-000000000001'))
negative(19,'demo_sales','BL_DUPLIQUE_REFUSE',lambda:delivery(19,'SIM-CMD-26-001',{3:2,27:10},'00000000-0000-4000-8000-000000000001'))
step(19,'demo_sales','DELIVERY','BL_CMD_2',lambda:delivery(19,'SIM-CMD-26-002'))
step(20,'demo_sales','DELIVERY','BL_SOLDE_CMD_1',lambda:delivery(20,'SIM-CMD-26-001'))
step(20,'demo_sales','SALES','PROPOSITION_PRIX_SPECIAL',lambda:propose_special(20))
step(20,'demo_director','SALES_SPECIAL','APPROBATION_PRIX_SPECIAL',lambda:approve_special(20))
negative(20,'demo_approver','VISA_TARIF_INTERDIT_APPROBATEUR',lambda:ensure_role('demo_approver','SALES_SPECIAL'))
step(23,'demo_finance','AP_INVOICE','FACTURE_FOURNISSEUR_MOUSSE',lambda:ap_invoice(23,'SIM-DA-26-001'))
step(23,'demo_finance','AP_INVOICE','FACTURE_FOURNISSEUR_TISSU',lambda:ap_invoice(23,'SIM-DA-26-002'))
step(23,'demo_finance','AP_INVOICE','FACTURE_FOURNISSEUR_MERCERIE',lambda:ap_invoice(23,'SIM-DA-26-003'))
negative(23,'demo_finance','FACTURE_3VOIES_SURQUANTITE_REFUSEE',lambda:ap_invoice_mismatch('SIM-DA-26-001',10))
negative(23,'demo_finance','AUTO_APPROBATION_FACTURE_REFUSEE',lambda:approve_ap_invoice(23,'SIM-DA-26-001',actor='demo_finance'))
for i in [1,2,3]:
 step(24,'demo_finance_2','AP_INVOICE','APPROBATION_FACTURE_FOURNISSEUR',lambda i=i:approve_ap_invoice(24,f'SIM-DA-26-{i:03d}'))
step(24,'demo_finance','AP_PAYMENT','PAIEMENT_FOURNISSEUR_PARTIEL',lambda:ap_payment(24,'SIM-DA-26-001'))
step(24,'demo_finance','AR_INVOICE','FACTURE_CLIENT_1',lambda:ar_invoice(24,'SIM-CMD-26-001'))
step(24,'demo_finance','AR_INVOICE','FACTURE_CLIENT_2',lambda:ar_invoice(24,'SIM-CMD-26-002'))
step(25,'demo_finance','AR_PAYMENT','ENCAISSEMENT_PARTIEL_CLIENT',lambda:ar_payment(25,'SIM-CMD-26-001'))
step(25,'demo_finance','CREDIT','PREPARATION_AVOIR_CLIENT',lambda:draft_credit(25,'SIM-CMD-26-001'))
negative(25,'demo_finance','AUTO_APPROBATION_AVOIR_REFUSEE',lambda:approve_credit(25,actor='demo_finance'))
step(26,'demo_finance_2','CREDIT','APPROBATION_AVOIR_CLIENT',lambda:approve_credit(26))
step(26,'demo_inventory','COUNT','INVENTAIRE_COMPTAGE',lambda:stock_count(26,1,15)) # lot1 old qty 16 less internal? untouched
step(27,'demo_approver','COUNT_APPROVE','INVENTAIRE_APPROUVE',lambda:approve_count(27))
step(27,'demo_buyer','DA','ANALYSE_REAPPRO_SUITE_VENTES',lambda:'comparer seuil, commandes ouvertes, reliquats')
step(30,'demo_admin','ADMIN','CLOTURE_CONTROLE_ACCES',lambda:'11 comptes fictifs actifs, revue pouvoirs')
step(30,'demo_finance','AP_INVOICE','CLOTURE_RAPPROCHEMENT',lambda:'factures / paiements, soldes client et fournisseur')

# Final independent checks
checks={}
checks['integrity']=c.execute('PRAGMA integrity_check').fetchone()[0]
checks['foreign_key_violations']=len(c.execute('PRAGMA foreign_key_check').fetchall())
checks['stock_material_diff_max']=max([abs(r['stockQty']-r['available']) for r in c.execute("SELECT m.stockQty,coalesce((select sum(qty) from StockLot l where l.materialId=m.id AND l.status='available'),0) available from Material m")]+[0])
checks['lot_placement_diff_max']=max([abs(r['qty']-r['placed']) for r in c.execute("SELECT l.qty,coalesce((select sum(qty) from StockPlacement p where p.stockLotId=l.id),0) placed from StockLot l where l.status='available'")]+[0])
checks['reservations_exceed_lot']=c.execute("SELECT count(*) FROM StockLot l WHERE l.qty+0.00001 < (SELECT coalesce(sum(qty),0) FROM SalesStockReservation r WHERE r.stockLotId=l.id)").fetchone()[0]
checks['negative_material_stocks']=c.execute('SELECT count(*) FROM Material WHERE stockQty < -0.00001').fetchone()[0]
checks['negative_stock_lots']=c.execute('SELECT count(*) FROM StockLot WHERE qty < -0.00001').fetchone()[0]
checks['sim_events']=c.execute('SELECT count(*) FROM SimEvent').fetchone()[0]
checks['sim_audits']=c.execute("SELECT count(*) FROM AuditEvent WHERE action LIKE 'SIM_%'").fetchone()[0]
checks['da']=c.execute("SELECT count(*) FROM PurchaseRequest WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['bc']=c.execute("SELECT count(*) FROM SupplierOrder WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['receipts']=c.execute("SELECT count(*) FROM GoodsReceipt WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['client_orders']=c.execute("SELECT count(*) FROM \"Order\" WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['deliveries']=c.execute("SELECT count(*) FROM SalesDelivery WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['ap_invoices']=c.execute("SELECT count(*) FROM SupplierInvoice WHERE invoiceNumber LIKE 'SIM-%'").fetchone()[0]
checks['ar_invoices']=c.execute("SELECT count(*) FROM SalesInvoice WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['special_prices_approved']=c.execute("SELECT count(*) FROM Product WHERE sku='SIM-PROD-SPECIAL-01' and specialPriceStatus='approved' and specialPriceApprovedBy='demo_director'").fetchone()[0]
checks['credits_approved']=c.execute("SELECT count(*) FROM SalesCreditNote WHERE ref LIKE 'SIM-%' and status='approved'").fetchone()[0]
checks['quality_inspections']=c.execute("SELECT count(*) FROM QualityInspection WHERE actor='demo_quality'").fetchone()[0]
checks['inventory_counts']=c.execute("SELECT count(*) FROM StockCount WHERE countedBy='demo_inventory'").fetchone()[0]
checks['failed_anticipated']=len(neg)

assert checks['integrity']=='ok' and checks['foreign_key_violations']==0
assert checks['stock_material_diff_max']<0.00001
assert checks['lot_placement_diff_max']<0.00001
assert checks['reservations_exceed_lot']==0
assert checks['negative_material_stocks']==0 and checks['negative_stock_lots']==0

def write_table(query,file):
 rows=c.execute(query).fetchall()
 with open(OUT/file,'w',newline='',encoding='utf-8-sig') as f:
  if rows:
   w=csv.DictWriter(f,fieldnames=rows[0].keys(),delimiter=';');w.writeheader();w.writerows([dict(x) for x in rows])
write_table('SELECT * FROM SimEvent ORDER BY id','JOURNAL_SIMULATION_21_JOURS.csv')
write_table("SELECT m.ref,m.name,m.unit,m.stockQty,m.minStock,m.averageCost,(SELECT coalesce(sum(qty),0) FROM StockLot l WHERE l.materialId=m.id AND l.status='available') AS totalLotsDisponibles,(SELECT coalesce(sum(r.qty),0) FROM SalesStockReservation r JOIN StockLot l ON l.id=r.stockLotId WHERE l.materialId=m.id) AS stockReserve FROM Material m ORDER BY id",'STOCK_FINAL_64_ARTICLES.csv')
write_table("SELECT ref,status,createdBy,approvedBy FROM PurchaseRequest WHERE ref LIKE 'SIM-%' ORDER BY id",'STATUT_DA.csv')
write_table("SELECT ref,status,supplierId,createdBy,approvedBy FROM SupplierOrder WHERE ref LIKE 'SIM-%' ORDER BY id",'STATUT_BC.csv')
write_table("SELECT o.ref,o.status,o.fulfillmentStatus,ol.qty,ol.unit,ol.unitPrice,p.name AS produit FROM \"Order\" o JOIN OrderLine ol ON ol.orderId=o.id JOIN Product p ON p.id=ol.productId WHERE o.ref LIKE 'SIM-%' ORDER BY o.id,ol.id",'COMMANDES_CLIENTS.csv')
(OUT/'RESULTATS_CONTROLES.json').write_text(json.dumps(checks,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps(checks,indent=2,ensure_ascii=False))
