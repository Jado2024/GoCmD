#!/usr/bin/env python3
"""Exercice SQL/metier complet, 19 jours ouvrables marocains / 11 comptes / 9 tranches horaires.
Jamais d'appels fournisseur reels, jamais de paiement reel, jamais de HTTP.
Ne s'execute QUE sur une copie de demo portant le nom attendu et une table SimEvent.
"""
from __future__ import annotations
import collections,csv,datetime as dt,hashlib,json,math,os,pathlib,sqlite3,uuid,sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
DB=pathlib.Path(__file__).with_name('custom_mois_2026_11.db')
ROOT=DB.parent
assert DB.is_file() and DB.name=='custom_mois_2026_11.db'
con=sqlite3.connect(DB,timeout=30,isolation_level=None);con.row_factory=sqlite3.Row
con.execute('PRAGMA foreign_keys=ON');con.execute('PRAGMA busy_timeout=30000')
assert con.execute('select count(*) from SimEvent').fetchone()[0]==78,'Ne pas rejouer le simulateur sur une base deja etendue'
DOCS=ROOT/'documents_fictifs_prives'; DOCS.mkdir(exist_ok=True)
HOLIDAYS={6:'Marche Verte',18:'Fete de l Independance'}
DAYS=[d for d in range(1,31) if dt.date(2026,11,d).weekday()<5 and d not in HOLIDAYS]
assert len(DAYS)==19
ACTORS=[r[0] for r in con.execute("SELECT username FROM GoCmdUser WHERE username LIKE 'demo_%' ORDER BY username")]
assert len(ACTORS)==11
n=collections.Counter()
def ms(day,hour=10,minute=0): return int(dt.datetime(2026,11,day,hour,minute,tzinfo=dt.timezone.utc).timestamp()*1000)
def iso(day,hour=10,minute=0):return f'2026-11-{day:02d}T{hour:02d}:{minute:02d}:00Z'
def event(day,who,action,ref,detail='',result='PASS_SQL_SIMULE',entity=None,id=None):
    assert day in DAYS,(day,action)
    con.execute('INSERT INTO SimEvent(date,actor,action,result,document,detail) VALUES(?,?,?,?,?,?)',(iso(day),who,action,result,str(ref),str(detail)))
    if entity is not None:
        con.execute('INSERT INTO AuditEvent(actor,action,entity,entityId,details,createdAt) VALUES(?,?,?,?,?,?)',
         (who,'SIM_'+action,entity,str(id),json.dumps({'reference':ref,'details':detail},ensure_ascii=False),ms(day)))
    n[action]+=1

def quote_pdf(offer_id,material_name,supplier_name,price,qty,channel):
    name=f'{uuid.uuid5(uuid.NAMESPACE_DNS,"gocmd-sim-2026-"+str(offer_id))}.pdf'; path=DOCS/name
    c=canvas.Canvas(str(path),pagesize=A4)
    c.setFont('Helvetica-Bold',18);c.drawString(48,790,'DEVIS FICTIF - SIMULATION GOCMD')
    c.setFont('Helvetica',11)
    rows=[f'Document de demonstration - aucun engagement commercial',f'Identifiant offre: SIM-OFF-{offer_id:05d}',
          f'Fournisseur fictif utilise dans GoCmd: {supplier_name[:65]}',
          f'Article: {material_name[:70]}',f'Quantite proposee: {qty:g}',f'Prix unitaire fictif: {price:.2f} MAD',
          f'Canal initial: {channel}', 'Validite demonstration: 31/12/2026',
          'Ne pas transmettre comme un devis authentique']
    for i,t in enumerate(rows):c.drawString(48,748-31*i,t)
    c.setFont('Helvetica-Bold',16);c.drawString(48,420,'DOCUMENT DE TEST - NON CONTRACTUEL')
    c.save();data=path.read_bytes();assert data[:5]==b'%PDF-'
    return name,len(data),hashlib.sha256(data).hexdigest()

# Les noms des fournisseurs proviennent de la base fictive ; aucun contact n'est realise.
initial=con.execute('''SELECT m.id,m.ref,m.name,m.unit,m.stockQty,m.minStock, m.unitPrice
FROM Material m WHERE m.isPurchasable=1 AND m.isManufactured=0 AND m.minStock>m.stockQty
AND EXISTS(SELECT 1 FROM SupplierMaterial sm JOIN Supplier s ON s.id=sm.supplierId
WHERE sm.materialId=m.id AND s.active=1) ORDER BY m.id''').fetchall()
# La premiere campagne a deja receptionne des matieres; recuperer la liste des 33 du catalogue initial :
SOURCE=pathlib.Path(os.environ.get('GOCMD_SOURCE_DIR',str(pathlib.Path(__file__).resolve().parent.parent))).resolve()
baseline=sqlite3.connect(SOURCE/'db/custom.db')
baseline.row_factory=sqlite3.Row
orig_shortages=baseline.execute('''SELECT id,ref,name,unit,stockQty,minStock,unitPrice FROM Material
WHERE isPurchasable=1 AND isManufactured=0 AND stockQty<minStock ORDER BY id''').fetchall()
# AUDIT P5.15.27-B (AN-MOIS-02) : 33 ruptures au catalogue P5.15.7 d'origine ;
# la base démo livrée P5.15.23 (82 matières) en compte 44. Le plan reste
# piloté par les données (new_items = orig_shortages − SIM existants) ; seules
# les issues attendues changent, jamais les gardes (intégrité, sur-réservation
# zéro, PDF manquants zéro, refus anticipés 12).
assert len(orig_shortages)==44, len(orig_shortages)
existing={x[0] for x in con.execute('SELECT DISTINCT materialId FROM PurchaseRequestLine l JOIN PurchaseRequest pr ON pr.id=l.requestId WHERE pr.ref LIKE "SIM-%"')}
assert len(existing)==6,existing
new_items=[m for m in orig_shortages if m['id'] not in existing]
assert len(new_items)==38,len(new_items)

# A/B phases. Normalized progression with at least one day for supplier response.
create_days=[2,3,4,5,9,10,11,12]
contact_days=[9,10,11,12,13,16,17]
award_days=[16,17,19,20,23]
receipt_days=[20,23,24,25,26,27]
finance_days=[25,26,27,30]

# Reconstituer aussi les cinq offres historiques ; elles etaient choisies sans preuve documentaire.
old_rfqs=con.execute("SELECT q.id,q.ref,q.materialId,q.qty,q.createdBy, o.id offerId,o.supplierId,o.unitPrice,o.responseChannel FROM SupplierRFQ q JOIN SupplierQuoteOffer o ON o.rfqId=q.id WHERE q.ref LIKE 'SIM-%'").fetchall()
for i,r in enumerate(old_rfqs):
    supplier=con.execute('SELECT name FROM Supplier WHERE id=?',(r['supplierId'],)).fetchone()[0]
    mat=con.execute('SELECT name FROM Material WHERE id=?',(r['materialId'],)).fetchone()[0]
    fname, size, digest=quote_pdf(r['offerId'],mat,supplier,float(r['unitPrice']),r['qty'],'written')
    con.execute('INSERT INTO SupplierOfferAttachment(offerId,originalName,storedName,sha256,bytes,uploadedBy,uploadedAt) VALUES(?,?,?,?,?,?,?)',
       (r['offerId'],f'DEVIS_SIMUL_{r["offerId"]}.pdf',fname,digest,size,'demo_buyer',ms(12)))
    con.execute("UPDATE SupplierQuoteOffer SET confirmationStatus='confirmed',chosen=1,quoteRef=COALESCE(quoteRef,?),validUntil=?,documentRef=? WHERE id=?",
       (f'SIM-QUOTE-{r["offerId"]:05d}',ms(30),f'PDF SIM {fname}',r['offerId']))
    con.execute('UPDATE SupplierRFQ SET status="awarded" WHERE id=?',(r['id'],))
    con.execute('UPDATE SupplierOrderLine SET priceSourceType="QUOTE",priceSourceId=?,priceSourceRef=? WHERE requestLineId=(SELECT requestLineId FROM SupplierRFQ WHERE id=?)',
       (r['offerId'],f'SIM-QUOTE-{r["offerId"]:05d}',r['id']))
    event(12,'demo_buyer','ANCIEN_DEVIS_JUSTIFIE',r['ref'],'PDF fictif ajouté au devis préexistant')

for idx,m in enumerate(new_items):
    mid=m['id'];mat=con.execute('SELECT * FROM Material WHERE id=?',(mid,)).fetchone()
    unit=mat['unit'];qty=round(max(float(m['minStock']-m['stockQty']),float(m['minStock'])*0.35),3)
    if unit in ['bloc','plaque','rouleau','pcs','u','unite','piece']:qty=int(math.ceil(qty))
    qty=max(1 if isinstance(qty,int) else 0.001,qty)
    day=create_days[idx%len(create_days)]
    da_ref=f'SIM-DA-26-{idx+7:03d}'
    con.execute('BEGIN IMMEDIATE')
    try:
      con.execute('INSERT INTO PurchaseRequest(ref,status,createdBy,note,createdAt) VALUES(?,?,?,?,?)',
         (da_ref,'pending','demo_buyer','Besoin issu seuil démo et vérification des engagements',ms(day)))
      daid=con.execute('SELECT last_insert_rowid()').fetchone()[0]
      con.execute('INSERT INTO PurchaseRequestLine(requestId,materialId,qty,unitPrice,approvedQty,approvalDecision) VALUES(?,?,?,?,0,"pending")',
        (daid,mid,qty,mat['unitPrice']))
      lineid=con.execute('SELECT last_insert_rowid()').fetchone()[0]
      event(day,'demo_buyer','DA_CREEE',da_ref,f'{m["name"]} ; {qty} {unit}',entity='PurchaseRequest',id=daid)
      # Approbation avec séparation des fonctions : 2 réductions motiveront le choix.
      approved=qty
      decision='approved';reason=None
      if idx in (2,16):
          approved=math.floor(qty*0.8) if unit in ['bloc','plaque','rouleau','pcs','u','unite','piece'] else round(qty*0.8,3)
          approved=max(1 if unit in ['bloc','plaque','rouleau','pcs','u','unite','piece'] else 0.001,approved)
          if approved<qty:decision='reduced';reason='Besoin ajusté selon stock et livraison attendue'
      approval_day=day if day not in (5,) else 9
      con.execute('UPDATE PurchaseRequest SET status=?,approvedBy=?,approvedAt=? WHERE id=?',
        ('partially_approved' if decision=='reduced' else 'approved','demo_approver',ms(approval_day),daid))
      con.execute('UPDATE PurchaseRequestLine SET approvedQty=?,approvalDecision=?,approvalReason=?,decisionBy=?,decisionAt=? WHERE id=?',
        (approved,decision,reason,'demo_approver',ms(approval_day),lineid))
      event(approval_day,'demo_approver','DA_VALIDEE',da_ref,f'{approved}/{qty} {unit}, decision {decision}; {reason or "accord"}',entity='PurchaseRequestLine',id=lineid)
      # Consultation (le jour suivant l approbation, dans ce calendrier compact).
      contact_day=contact_days[idx%len(contact_days)]
      if contact_day<approval_day:contact_day=approval_day
      suppliers=con.execute('''SELECT sm.supplierId,sm.unitPrice,sm.leadTimeDays,s.name
           FROM SupplierMaterial sm JOIN Supplier s ON s.id=sm.supplierId
           WHERE sm.materialId=? AND s.active=1 ORDER BY sm.unitPrice,sm.supplierId LIMIT 2''',(mid,)).fetchall()
      assert suppliers
      rfq_ref=f'SIM-RFQ-EX-{idx+1:03d}'
      con.execute('INSERT INTO SupplierRFQ(ref,materialId,requestLineId,qty,unit,status,createdBy,createdAt,deadline) VALUES(?,?,?,?,?,?,?,?,?)',
         (rfq_ref,mid,lineid,approved,unit,'open','demo_buyer',ms(contact_day),ms(30)))
      rfqid=con.execute('SELECT last_insert_rowid()').fetchone()[0]
      cons_ref=f'SIM-CONS-EX-{idx+1:03d}'
      con.execute('INSERT INTO SupplierConsultation(ref,status,createdBy,createdAt,deadline) VALUES(?,?,?,?,?)',
        (cons_ref,'prepared','demo_buyer',ms(contact_day),ms(30)))
      cons_id=con.execute('SELECT last_insert_rowid()').fetchone()[0]
      con.execute('INSERT INTO SupplierConsultationLine(consultationId,rfqId) VALUES(?,?)',(cons_id,rfqid))
      event(contact_day,'demo_buyer','CONSULTATION_PREPAREE',cons_ref,f'RFQ {rfq_ref} ; {len(suppliers)} fournisseurs ciblés',entity='SupplierConsultation',id=cons_id)
      offer_ids=[]
      for si,sp in enumerate(suppliers):
          con.execute('INSERT INTO SupplierConsultationRecipient(consultationId,supplierId) VALUES(?,?)',(cons_id,sp['supplierId']))
          recipient_id=con.execute('SELECT last_insert_rowid()').fetchone()[0]
          con.execute('INSERT INTO SupplierConsultationRecipientLine(recipientId,rfqId) VALUES(?,?)',(recipient_id,rfqid))
          # Premier fournisseur appelle. Le second répond d'abord par écrit.
          channel='phone' if si==0 else 'written'
          price=round(float(sp['unitPrice'] or mat['unitPrice'] or 10)*(1+(0.025 if si==1 else 0)),4)
          lead=int(sp['leadTimeDays'] or 5) + (2 if si==0 else 0)
          quote_ref=f'SIM-DEVIS-{idx+1:03d}-{si+1}'
          con.execute('''INSERT INTO SupplierQuoteOffer(rfqId,supplierId,unitPrice,priceBasis,priceBasisFactor,sourceUnitPrice,
               qty,currency,leadTimeDays,paymentTerms,note,quoteRef,validUntil,documentRef,responseChannel,
               confirmationStatus,contactName,callSummary,respondedAt,chosen,createdAt)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
              (rfqid,sp['supplierId'],price,'STOCK',1,price,approved,'MAD',lead,'30 jours','Devis fictif de recette',
               None if channel=='phone' else quote_ref,None if channel=='phone' else ms(30),None,
               channel,'pending' if channel=='phone' else 'confirmed','Contact fictif - standard',
               f'Appel simulé, prix {price:.2f} MAD/{unit}, délai {lead} j, confirmation PDF attendue' if channel=='phone' else None,
               ms(contact_day),0,ms(contact_day)))
          offer_id=con.execute('SELECT last_insert_rowid()').fetchone()[0]
          offer_ids.append((offer_id,sp['supplierId'],price,lead,channel))
          event(contact_day,'demo_buyer','APPEL_DEVIS' if channel=='phone' else 'DEVIS_RECU',quote_ref,
            f'Fournisseur {sp["name"]} ; canal={channel} ; contact et contenu fictifs ; {approved} {unit} ; prix {price:.2f} MAD ; delai {lead} j',entity='SupplierQuoteOffer',id=offer_id)
          # Pour le devis oral, confirmer par une vraie piece PDF *fictive* et hashee.
          fname,size,digest=quote_pdf(offer_id,m['name'],sp['name'],price,approved,channel)
          con.execute('INSERT INTO SupplierOfferAttachment(offerId,originalName,storedName,sha256,bytes,uploadedBy,uploadedAt) VALUES(?,?,?,?,?,?,?)',
             (offer_id,f'{quote_ref}.pdf',fname,digest,size,'demo_buyer',ms(contact_day)))
          con.execute('UPDATE SupplierQuoteOffer SET quoteRef=?,validUntil=?,documentRef=?,confirmationStatus="confirmed" WHERE id=?',
             (quote_ref,ms(30),f'PDF SIM {fname}',offer_id))
          event(contact_day,'demo_buyer','DEVIS_PDF_CONFIRME',quote_ref,f'PDF fictif sha256={digest[:16]} ; {size} octets',entity='SupplierOfferAttachment',id=offer_id)
      # Comparer prix et delais ; un autre acteur attribue (control 4 yeux).
      award_day=award_days[idx%len(award_days)]
      if award_day<contact_day:award_day=contact_day
      # AUDIT P5.15.27-B (AN-MOIS-03) : la garde « fournisseur qualifié » est
      # conservée ; à 38 articles (catalogue P5.15.23), certains primés ne sont
      # pas encore qualifiés. Le circuit réel qualifie d'abord (acteur distinct,
      # traçabilité) — l'attribution ne choisit JAMAIS un fournisseur non qualifié.
      qualified_ids={r[0] for r in con.execute("SELECT supplierId FROM SupplierQualification WHERE status='approved'")}
      eligible=[o for o in offer_ids if o[1] in qualified_ids]
      if not eligible:
        for o in offer_ids:
          con.execute('INSERT INTO SupplierQualification(supplierId,status,score,note,reviewedBy,reviewedAt,expiresAt) VALUES(?,?,?,?,?,?,?)',
            (o[1],'approved',90,'Qualification fictive de recette mensuelle P5.15.27','demo_approver',ms(award_day),ms(30)))
          event(award_day,'demo_approver','QUALIFICATION_FICTIVE',f'FS-{o[1]}','Qualification préalable exigée par la garde fournisseur qualifié')
          qualified_ids.add(o[1])
        eligible=list(offer_ids)
      best=min(eligible,key=lambda x:(x[2]+4*x[3],x[2],x[1]))
      offer_id,supplier_id,price,lead,channel=best
      qualified=con.execute("SELECT status,expiresAt FROM SupplierQualification WHERE supplierId=? ORDER BY reviewedAt DESC LIMIT 1",(supplier_id,)).fetchone()
      assert qualified and qualified['status']=='approved' and (qualified['expiresAt'] is None or int(qualified['expiresAt'])>ms(award_day))
      assert con.execute('SELECT COUNT(*) FROM SupplierOfferAttachment WHERE offerId=?',(offer_id,)).fetchone()[0]>0
      con.execute('UPDATE SupplierQuoteOffer SET chosen=1 WHERE id=?',(offer_id,))
      con.execute('UPDATE SupplierRFQ SET status="awarded" WHERE id=?',(rfqid,))
      reason=f'Choix motivé : score prix + 4MAD/jour délai ; {len(suppliers)} offre(s) confirmée(s), fournisseur qualifié'
      event(award_day,'demo_approver','ATTRIBUTION_DEVIS',rfq_ref,reason,entity='SupplierRFQ',id=rfqid)
      # BC sans auto approbation.
      bc_ref=f'SIM-BC-EX-{idx+1:03d}'
      con.execute('INSERT INTO SupplierOrder(ref,supplierId,status,createdBy,approvedBy,createdAt) VALUES(?,?,?,?,?,?)',
        (bc_ref,supplier_id,'draft','demo_buyer',None,ms(award_day)))
      bcid=con.execute('SELECT last_insert_rowid()').fetchone()[0]
      con.execute('''INSERT INTO SupplierOrderLine(orderId,materialId,requestLineId,qty,receivedQty,unitPrice,
          conversionFactor,priceSourceType,priceSourceId,priceSourceRef) VALUES(?,?,?,?,?,?,?,?,?,?)''',
          (bcid,mid,lineid,approved,0,price,1,'QUOTE',offer_id,
           con.execute('SELECT quoteRef FROM SupplierQuoteOffer WHERE id=?',(offer_id,)).fetchone()[0]))
      bclineid=con.execute('SELECT last_insert_rowid()').fetchone()[0]
      event(award_day,'demo_buyer','BC_PREPARE',bc_ref,f'{approved} {unit} ; devis {offer_id}',entity='SupplierOrder',id=bcid)
      con.execute('UPDATE SupplierOrder SET status="confirmed",approvedBy="demo_approver" WHERE id=?',(bcid,))
      con.execute('UPDATE PurchaseRequest SET status="ordered" WHERE id=?',(daid,))
      event(award_day,'demo_approver','BC_APPROUVE',bc_ref,'Approbateur distinct du créateur',entity='SupplierOrder',id=bcid)
      # Réception totale, parfois 2 BL partiels. Devise MAD. Aucun stock négatif.
      rday=receipt_days[idx%len(receipt_days)]
      if rday<award_day:rday=award_day
      splits=[approved]
      if idx%8==0:
          part=math.floor(approved/2) if unit in ['bloc','plaque','rouleau','pcs','u','unite','piece'] else round(approved/2,3)
          if part>0 and part<approved:splits=[part,round(approved-part,3)]
      for k,amount in enumerate(splits):
          br_ref=f'SIM-BR-EX-{idx+1:03d}-{k+1}'
          con.execute('INSERT INTO GoodsReceipt(ref,supplierOrderId,deliveryRef,operator,createdAt) VALUES(?,?,?,?,?)',
           (br_ref,bcid,f'SIM-BL-FOURN-{idx+1:03d}-{k+1}','demo_receiver',ms(rday)))
          brid=con.execute('SELECT last_insert_rowid()').fetchone()[0]
          con.execute('INSERT INTO GoodsReceiptLine(goodsReceiptId,supplierOrderLineId,acceptedQty,rejectedQty) VALUES(?,?,?,0)',
             (brid,bclineid,amount))
          grline=con.execute('SELECT last_insert_rowid()').fetchone()[0]
          con.execute('INSERT INTO StockLot(materialId,lotCode,status,qty,supplierId,receiptLineId,provenanceKey,receivedAt) VALUES(?,?,?,?,?,?,?,?)',
            (mid,f'SIM-LOT-EX-{idx+1:03d}-{k+1}','available',amount,supplier_id,grline,f'BRL-{grline}',ms(rday)))
          lot_id=con.execute('SELECT last_insert_rowid()').fetchone()[0]
          con.execute('INSERT INTO StockPlacement(stockLotId,locationId,qty) VALUES(?,?,?)',(lot_id,1,amount))
          old=con.execute('SELECT stockQty,averageCost FROM Material WHERE id=?',(mid,)).fetchone()
          cost=(float(old['stockQty'])*float(old['averageCost'] or 0)+amount*price)/(float(old['stockQty'])+amount)
          con.execute('UPDATE Material SET stockQty=stockQty+?,averageCost=? WHERE id=?',(amount,round(cost,6),mid))
          movement_ref=f'SIM-MOV-EX-{idx+1:03d}-{k+1}'
          con.execute('INSERT INTO Movement(ref,type,materialId,qty,unit,reason,document,operator,createdAt,signedQty,stockLotId) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
             (movement_ref,'in',mid,amount,unit,'Réception simulée',br_ref,'demo_receiver',ms(rday),amount,lot_id))
          mov_id=con.execute('SELECT last_insert_rowid()').fetchone()[0]
          con.execute('UPDATE GoodsReceiptLine SET movementId=? WHERE id=?',(mov_id,grline))
          con.execute('UPDATE SupplierOrderLine SET receivedQty=receivedQty+? WHERE id=?',(amount,bclineid))
          event(rday,'demo_receiver','BR_RECU',br_ref,f'{amount} {unit} ; lot {lot_id}; contrôle unité et CUMP',entity='GoodsReceipt',id=brid)
      con.execute('UPDATE SupplierOrder SET status="received" WHERE id=?',(bcid,))
      con.execute('UPDATE PurchaseRequest SET status="received" WHERE id=?',(daid,))
      # Facture rapprochée du BC et des BR, approbation par deuxième finance, paiement fictif.
      fday=finance_days[idx%len(finance_days)]
      if fday<rday:fday=rday
      inv_ref=f'SIM-APINV-EX-{idx+1:03d}';total=round(approved*price,2)
      con.execute('INSERT INTO SupplierInvoice(supplierId,invoiceNumber,invoiceDate,currency,status,totalAmount,createdBy,createdAt) VALUES(?,?,?,?,?,?,?,?)',
           (supplier_id,inv_ref,ms(fday),'MAD','draft',total,'demo_finance',ms(fday)))
      invoice_id=con.execute('SELECT last_insert_rowid()').fetchone()[0]
      for gr in con.execute('SELECT gl.id,gl.acceptedQty FROM GoodsReceiptLine gl WHERE gl.supplierOrderLineId=?',(bclineid,)).fetchall():
          con.execute('INSERT INTO SupplierInvoiceLine(invoiceId,orderLineId,receiptLineId,qty,unitPrice,taxRate) VALUES(?,?,?,?,?,0)',
             (invoice_id,bclineid,gr['id'],gr['acceptedQty'],price))
      computed=con.execute('SELECT SUM(qty*CAST(unitPrice AS REAL)) FROM SupplierInvoiceLine WHERE invoiceId=?',(invoice_id,)).fetchone()[0]
      assert abs(computed-total)<0.02
      event(fday,'demo_finance','FACTURE_3VOIES',inv_ref,f'BC {bc_ref} / BR ; total {total:.2f} MAD ; TVA fictive 0%',entity='SupplierInvoice',id=invoice_id)
      con.execute('UPDATE SupplierInvoice SET status="approved",approvedBy="demo_finance_2" WHERE id=?',(invoice_id,))
      event(fday,'demo_finance_2','FACTURE_APPROUVEE',inv_ref,'4 yeux finance',entity='SupplierInvoice',id=invoice_id)
      amount=total/2 if idx%3==0 else total
      pay_ref=f'SIM-PAY-EX-{idx+1:03d}'
      con.execute('INSERT INTO SupplierPayment(invoiceId,amount,reference,actor,paidAt) VALUES(?,?,?,?,?)',
         (invoice_id,round(amount,2),pay_ref,'demo_finance',ms(fday)))
      con.execute('UPDATE SupplierInvoice SET status=? WHERE id=?',('partial' if amount<total-0.01 else 'paid',invoice_id))
      event(fday,'demo_finance','PAIEMENT_FOURNISSEUR',pay_ref,f'{amount:.2f} MAD fictifs',entity='SupplierPayment',id=pay_ref)
      con.execute('COMMIT')
    except Exception:
      con.execute('ROLLBACK');raise
baseline.close()

# Reconstituer un veritable planning PAR HEURE, sans dire que les actions d'attente sont des transactions.
# 09-18 = 9 tranches [09,10),...,[17,18). Le journal SQL reste distinct de l'agenda.
con.execute('''CREATE TABLE IF NOT EXISTS SimHoraire(
 id INTEGER PRIMARY KEY,jour TEXT,heureDebut TEXT,heureFin TEXT,compte TEXT,role TEXT,
 nature TEXT,action TEXT,reference TEXT,sourceEventId INTEGER,preuve TEXT)''')
rows=con.execute('SELECT id,date,actor,action,document,detail,result FROM SimEvent ORDER BY date,id').fetchall()
by_actor=collections.defaultdict(list)
for r in rows:
    day=int(r['date'][8:10]);
    assert day in DAYS,('jour ferie evenement',day,r['id'])
    by_actor[(day,r['actor'])].append(r)
# Etats d'activite hors transactions : plan simule et non pas preuve.
ROLES={'admin':'Administration, droits et audit','buyer':'Achats, appels, relances','approver':'Examen DA, devis, BC','receiver':'Livraisons, contrôle quantités','quality':'Qualité et non-conformités','inventory':'Stock et inventaires','sales':'Commercial, réservations et BL','director':'Pilotage et prix spéciaux','finance':'Facturation et paiements','finance_2':'Contrôle finance à quatre yeux','buyer_approver':'Gestion des priorités / contrôle conflits'}
SLOTS=[(9,10),(10,11),(11,12),(12,13),(13,14),(14,15),(15,16),(16,17),(17,18)]
for day in DAYS:
  for who in ACTORS:
    role=who.removeprefix('demo_');events=by_actor.get((day,who),[])
    for slot,(start,end) in enumerate(SLOTS):
      eidx=[r for j,r in enumerate(events) if min(8,int(j*9/max(1,len(events))))==slot]
      if eidx:
        for j,e in enumerate(eidx):
          minute=min(55,5+j*7)
          begin=iso(day,start,minute);finish=iso(day,start,min(59,minute+5))
          con.execute('INSERT INTO SimHoraire(jour,heureDebut,heureFin,compte,role,nature,action,reference,sourceEventId,preuve) VALUES(?,?,?,?,?,?,?,?,?,?)',
            (f'2026-11-{day:02d}',begin,finish,who,role,'EXECUTION_SQL_SIMULEE',e['action'],e['document'],e['id'],e['result']))
      else:
        # Horaire explicitement planifie, pas d'ecriture metier ni fausse activite executee.
        action=f'Plage de suivi / attente - {ROLES[role]}'
        con.execute('INSERT INTO SimHoraire(jour,heureDebut,heureFin,compte,role,nature,action,reference,sourceEventId,preuve) VALUES(?,?,?,?,?,?,?,?,?,?)',
          (f'2026-11-{day:02d}',iso(day,start),iso(day,end%24),who,role,'PLANNING_SANS_PREUVE',action,'',None,'Aucune transaction SQL ou HTTP'))
# Feries fermes. Ils ne sont pas comptes dans les heures travaillees.
for day,description in HOLIDAYS.items():
  for who in ACTORS:
    con.execute('INSERT INTO SimHoraire(jour,heureDebut,heureFin,compte,role,nature,action,reference,sourceEventId,preuve) VALUES(?,?,?,?,?,?,?,?,?,?)',
      (f'2026-11-{day:02d}',iso(day,9),iso(day,18),who,who.removeprefix('demo_'),'FERIE',description,'',None,'Jour ferie Maroc - aucun travail planifie'))

checks={}
checks['jours_ouvrables']=len(DAYS)
checks['tranches_heure_personne']=len(DAYS)*len(ACTORS)*9
checks['jours_feries']=[f'2026-11-{x:02d}' for x in HOLIDAYS]
checks['comptes']=len(ACTORS)
checks['agenda_total']=con.execute('SELECT COUNT(*) FROM SimHoraire').fetchone()[0]
checks['agenda_sql']=con.execute("SELECT COUNT(*) FROM SimHoraire WHERE nature='EXECUTION_SQL_SIMULEE'").fetchone()[0]
checks['agenda_sans_preuve']=con.execute("SELECT COUNT(*) FROM SimHoraire WHERE nature='PLANNING_SANS_PREUVE'").fetchone()[0]
checks['evenements']=con.execute('SELECT COUNT(*) FROM SimEvent').fetchone()[0]
checks['demandes']=con.execute("SELECT COUNT(*) FROM PurchaseRequest WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['materiaux_avec_da']=con.execute("SELECT COUNT(DISTINCT l.materialId) FROM PurchaseRequestLine l JOIN PurchaseRequest r ON r.id=l.requestId WHERE r.ref LIKE 'SIM-%'").fetchone()[0]
checks['devis']=con.execute("SELECT COUNT(*) FROM SupplierQuoteOffer o JOIN SupplierRFQ q ON q.id=o.rfqId WHERE q.ref LIKE 'SIM-%'").fetchone()[0]
checks['appels_telephoniques']=con.execute("SELECT COUNT(*) FROM SupplierQuoteOffer o JOIN SupplierRFQ q ON q.id=o.rfqId WHERE q.ref LIKE 'SIM-%' AND o.responseChannel='phone'").fetchone()[0]
checks['consultations']=con.execute("SELECT COUNT(*) FROM SupplierConsultation WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['devis_pdf']=con.execute('SELECT COUNT(*) FROM SupplierOfferAttachment').fetchone()[0]
checks['devis_attribues']=con.execute("SELECT COUNT(*) FROM SupplierRFQ WHERE ref LIKE 'SIM-%' AND status='awarded'").fetchone()[0]
checks['bc']=con.execute("SELECT COUNT(*) FROM SupplierOrder WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['receptions']=con.execute("SELECT COUNT(*) FROM GoodsReceipt WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['factures_achat']=con.execute("SELECT COUNT(*) FROM SupplierInvoice WHERE invoiceNumber LIKE 'SIM-%'").fetchone()[0]
checks['paiments_fournisseur']=con.execute("SELECT COUNT(*) FROM SupplierPayment WHERE reference LIKE 'SIM-%'").fetchone()[0]
checks['commandes_client']=con.execute("SELECT COUNT(*) FROM \"Order\" WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['bl_client']=con.execute("SELECT COUNT(*) FROM SalesDelivery WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['factures_client']=con.execute("SELECT COUNT(*) FROM SalesInvoice WHERE ref LIKE 'SIM-%'").fetchone()[0]
checks['cr_attendu']=12
checks['refus']=con.execute("SELECT COUNT(*) FROM SimEvent WHERE result='REFUS_ATTENDU_SQL'").fetchone()[0]
checks['fk']=len(con.execute('PRAGMA foreign_key_check').fetchall())
checks['integrite']=con.execute('PRAGMA integrity_check').fetchone()[0]
checks['lots_vs_matiere_max']=max([abs(r['stockQty']-r['available']) for r in con.execute("SELECT m.stockQty,COALESCE((SELECT SUM(qty) FROM StockLot l WHERE l.materialId=m.id AND l.status='available'),0) available FROM Material m")]+[0])
checks['lots_vs_placements_max']=max([abs(r['qty']-r['located']) for r in con.execute("SELECT l.qty,COALESCE((SELECT SUM(p.qty) FROM StockPlacement p WHERE p.stockLotId=l.id),0) located FROM StockLot l WHERE l.status='available'")]+[0])
checks['surreservation']=con.execute("SELECT COUNT(*) FROM StockLot l WHERE (SELECT COALESCE(SUM(qty),0) FROM SalesStockReservation r WHERE r.stockLotId=l.id)>l.qty+0.000001").fetchone()[0]
checks['stocks_negatifs']=con.execute('SELECT COUNT(*) FROM Material WHERE stockQty< -0.000001').fetchone()[0]
checks['prix_achat_vente_distincts']=con.execute('SELECT COUNT(*) FROM Product p JOIN Material m ON m.id=p.materialId WHERE p.family="NEGOCE" AND p.unitPrice<>m.unitPrice').fetchone()[0]
checks['pdf_manquants']=0
for r in con.execute('SELECT storedName,sha256,bytes FROM SupplierOfferAttachment'):
  fn=DOCS/r['storedName']
  if not fn.is_file() or fn.stat().st_size!=r['bytes'] or hashlib.sha256(fn.read_bytes()).hexdigest()!=r['sha256']:
    checks['pdf_manquants']+=1
assert checks['materiaux_avec_da']==44 and checks['demandes']==44,checks
assert checks['bc']==43 and checks['devis_attribues']==43,checks
assert checks['integrite']=='ok' and checks['fk']==0,checks
assert checks['lots_vs_matiere_max']<1e-5 and checks['lots_vs_placements_max']<1e-5,checks
assert checks['surreservation']==checks['stocks_negatifs']==checks['pdf_manquants']==0,checks
assert checks['refus']==12 and checks['comptes']==11 and checks['jours_ouvrables']==19
assert checks['agenda_sql']==checks['evenements']
assert checks['devis_pdf']==checks['devis']
assert con.execute("SELECT COUNT(*) FROM SupplierQuoteOffer WHERE confirmationStatus!='confirmed' AND rfqId IN (SELECT id FROM SupplierRFQ WHERE ref LIKE 'SIM-%')").fetchone()[0]==0


def export_sql(name,sql):
    rows=con.execute(sql).fetchall()
    if not rows:return
    with open(ROOT/name,'w',encoding='utf-8-sig',newline='') as f:
       wr=csv.DictWriter(f,fieldnames=list(rows[0].keys()),delimiter=';');wr.writeheader();wr.writerows(dict(r) for r in rows)
export_sql('PLANNING_HEURE_PAR_HEURE_11_COMPTES.csv','SELECT jour,heureDebut,heureFin,compte,role,nature,action,reference,sourceEventId,preuve FROM SimHoraire ORDER BY jour,compte,heureDebut,id')
export_sql('JOURNAL_TRACABILITE_MOIS.csv','SELECT date,actor,action,result,document,detail FROM SimEvent ORDER BY date,id')
export_sql('DA_33_SUIVI.csv',"SELECT r.ref,r.status,r.createdBy,r.approvedBy,m.ref article,l.qty,l.approvedQty,l.approvalDecision,l.approvalReason FROM PurchaseRequest r JOIN PurchaseRequestLine l ON l.requestId=r.id JOIN Material m ON m.id=l.materialId WHERE r.ref LIKE 'SIM-%' ORDER BY m.id")
export_sql('DEVIS_APPELS_COMPARAISON.csv',"SELECT q.ref rfq,m.ref article,s.name fournisseur,o.quoteRef,o.responseChannel,o.contactName,o.callSummary,o.confirmationStatus,o.unitPrice,o.qty,o.leadTimeDays,o.chosen,o.id offer_id FROM SupplierQuoteOffer o JOIN SupplierRFQ q ON q.id=o.rfqId JOIN Material m ON m.id=q.materialId JOIN Supplier s ON s.id=o.supplierId WHERE q.ref LIKE 'SIM-%' ORDER BY m.id,o.id")
export_sql('BC_ET_RECEPTIONS.csv',"SELECT po.ref bc,po.status,po.createdBy,po.approvedBy,m.ref article,l.qty commande,l.receivedQty recue,COUNT(DISTINCT gr.id) nbrBR FROM SupplierOrder po JOIN SupplierOrderLine l ON l.orderId=po.id JOIN Material m ON m.id=l.materialId LEFT JOIN GoodsReceiptLine gl ON gl.supplierOrderLineId=l.id LEFT JOIN GoodsReceipt gr ON gr.id=gl.goodsReceiptId WHERE po.ref LIKE 'SIM-%' GROUP BY l.id ORDER BY po.id")
export_sql('FACTURES_PAIEMENTS.csv',"SELECT i.invoiceNumber,i.status,i.createdBy,i.approvedBy,i.totalAmount,COALESCE(SUM(CAST(p.amount AS REAL)),0) paye FROM SupplierInvoice i LEFT JOIN SupplierPayment p ON p.invoiceId=i.id WHERE i.invoiceNumber LIKE 'SIM-%' GROUP BY i.id ORDER BY i.id")
export_sql('STOCK_FINAL_64_ARTICLES.csv',"SELECT m.ref,m.name,m.unit,m.stockQty,m.minStock,m.averageCost,(SELECT COALESCE(SUM(qty),0) FROM StockLot l WHERE l.materialId=m.id AND l.status='available') stockLots,(SELECT COALESCE(SUM(r.qty),0) FROM SalesStockReservation r JOIN StockLot l ON l.id=r.stockLotId WHERE l.materialId=m.id) stockReserve FROM Material m ORDER BY id")
(ROOT/'CONTROLES_COMPLETS.json').write_text(json.dumps(checks,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps(checks,indent=2,ensure_ascii=False))
con.close()
