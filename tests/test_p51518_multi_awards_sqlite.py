"""Recette STRUCTURELLE SQLite sur copie (ne teste pas les API Next.js)."""
from pathlib import Path
import sqlite3, shutil, tempfile
from subprocess import run
R=Path(__file__).resolve().parents[1]
source=R/'db/custom.db'
with tempfile.TemporaryDirectory(prefix='gocmd-awards-') as directory:
    db=Path(directory)/'custom.db'
    shutil.copy2(source,db)
    before=sqlite3.connect(db)
    baseline={t:before.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in ['Material','Supplier','StockLot','PurchaseRequest','SupplierRFQ','SupplierOrder','SupplierAwardPlan']}
    before.close()
    for _ in range(2):run(['python',str(R/'scripts/upgrade_multi_awards_p51518.py'),'--db',str(db),'--apply'],check=True,capture_output=True)
    c=sqlite3.connect(db);c.execute('PRAGMA foreign_keys=ON')
    assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not c.execute('PRAGMA foreign_key_check').fetchall()
    for tbl in ['SupplierAwardPlan','SupplierAwardAllocation','SupplierQuoteRevision']:
        assert tbl in {x[0] for x in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"revisionNo"}.issubset(x[1] for x in c.execute('PRAGMA table_info("SupplierOfferAttachment")'))
    m=c.execute('SELECT m.id,m.unit FROM Material m JOIN SupplierMaterial s ON s.materialId=m.id JOIN Supplier f ON f.id=s.supplierId AND f.active=1 GROUP BY m.id HAVING COUNT(s.id)>=2 LIMIT 1').fetchone()
    assert m, 'No multi-source material in demo'
    material,unit=m
    suppliers=[r[0] for r in c.execute('SELECT supplierId FROM SupplierMaterial WHERE materialId=? LIMIT 2',(material,))]
    assert len(suppliers)==2
    c.execute('BEGIN IMMEDIATE')
    da=c.execute("INSERT INTO PurchaseRequest(ref,status,createdBy,approvedBy) VALUES (?,?,?,?)",('DA-SIMUL-100','approved','acheteur','responsable_achats')).lastrowid
    line=c.execute('INSERT INTO PurchaseRequestLine(requestId,materialId,qty,approvedQty,approvalDecision) VALUES (?,?,?,?,?)',(da,material,100,100,'approved')).lastrowid
    rfq=c.execute('INSERT INTO SupplierRFQ(ref,materialId,requestLineId,qty,unit,createdBy) VALUES(?,?,?,?,?,?)',('RFQ-SIMUL-100',material,line,100,unit,'acheteur')).lastrowid
    quote_ids=[]
    for supplier,qty,price in zip(suppliers,[60,40],[100,108]):
        quote_ids.append(c.execute('INSERT INTO SupplierQuoteOffer(rfqId,supplierId,unitPrice,qty,leadTimeDays,responseChannel,confirmationStatus,quoteRef,validUntil,recordedBy,buyerValidatedBy,buyerValidatedAt,approvedBy,approvedAt,contactName,callSummary,respondedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(rfq,supplier,price,qty,7,'phone','confirmed',f'TEL-TEST-{supplier}','2026-11-20 23:59:59','acheteur','acheteur','2026-11-07 10:00:00','responsable_achats','2026-11-07 10:05:00','Commercial','Offre recue par telephone, controlee','2026-11-07 09:55:00')).lastrowid)
    plan=c.execute('INSERT INTO SupplierAwardPlan(rfqId,status,reason,proposedBy,decidedBy,decidedAt) VALUES (?,?,?,?,?,?)',(rfq,'approved','Partage pour garantir approvisionnement et delai','acheteur','responsable_achats','2026-11-07 10:30:00')).lastrowid
    for offer,qty,price in zip(quote_ids,[60,40],[100,108]):
        c.execute('INSERT INTO SupplierAwardAllocation(planId,offerId,qty,unitPrice) VALUES(?,?,?,?)',(plan,offer,qty,price))
    assert c.execute('SELECT sum(qty) FROM SupplierAwardAllocation WHERE planId=?',(plan,)).fetchone()[0]==100
    try:
        c.execute('INSERT INTO SupplierAwardAllocation(planId,offerId,qty,unitPrice) VALUES(?,?,?,?)',(plan,quote_ids[0],1,100))
        raise AssertionError('Missing duplicate constraint')
    except sqlite3.IntegrityError:pass
    for supplier,offer,qty,price in zip(suppliers,quote_ids,[60,40],[100,108]):
        bc=c.execute('INSERT INTO SupplierOrder(ref,supplierId,createdBy,status) VALUES(?,?,?,?)',(f'BC-SIMUL-{supplier}',supplier,'acheteur','draft')).lastrowid
        c.execute('INSERT INTO SupplierOrderLine(orderId,materialId,requestLineId,qty,unitPrice,priceSourceType,priceSourceId) VALUES (?,?,?,?,?,?,?)',(bc,material,line,qty,price,'QUOTE',offer))
    assert c.execute('SELECT sum(qty) FROM SupplierOrderLine WHERE requestLineId=?',(line,)).fetchone()[0]==100
    assert not c.execute('PRAGMA foreign_key_check').fetchall()
    c.rollback()  # This scenario never touches distributed base
    for table,count in baseline.items():assert c.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]==count,(table,count)
    c.close()
print('PASS P5.15.18 : migration x2 sans perte + scénario SQLite 60/40 -> 2 BC, test isolé')
