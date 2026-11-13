#!/usr/bin/env python3
"""P5.15.0 — migrations idempotentes, protection du catalogue, reset démo sur copie."""
import sqlite3
import shutil
import tempfile
import sys
from pathlib import Path
from contextlib import closing
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import upgrade_da_line_approval_p5150 as migration
import prepare_demo_p5143 as preparation

with tempfile.TemporaryDirectory(prefix='gocmd-p5150-') as tmp:
    db=Path(tmp)/'test.db'
    shutil.copy2(ROOT/'db/custom.db',db)
    # Construire explicitement une fixture de schema legacy sur la copie, meme si
    # la livraison P5.15.7 contient deja les colonnes migrees.
    with closing(sqlite3.connect(db)) as legacy:
        cols={r[1] for r in legacy.execute('PRAGMA table_info(PurchaseRequestLine)')}
        for column in reversed(list(migration.FIELDS)):
            if column in cols:
                legacy.execute(f'ALTER TABLE PurchaseRequestLine DROP COLUMN "{column}"')
        legacy.commit()
    # Nous simulons trois demandes fictives sur la copie, sans toucher à la source.
    with closing(sqlite3.connect(db)) as con:
        material=con.execute('SELECT id FROM Material LIMIT 1').fetchone()[0]
        for ref,status,actor in [('QA-P5150-1','pending',None),('QA-P5150-2','approved','chef'),('QA-P5150-3','cancelled',None)]:
            cur=con.execute('INSERT INTO PurchaseRequest(ref,status,createdBy,approvedBy) VALUES(?,?,?,?)',(ref,status,'demandeur',actor))
            con.execute('INSERT INTO PurchaseRequestLine(requestId,materialId,qty) VALUES(?,?,?)',(cur.lastrowid,material,10))
        con.commit()
    migration.upgrade(db)
    with closing(sqlite3.connect(db)) as con:
        actual=con.execute('''SELECT r.status,l.approvedQty,l.approvalDecision FROM PurchaseRequestLine l
            JOIN PurchaseRequest r ON r.id=l.requestId WHERE r.ref LIKE 'QA-P5150-%' ORDER BY r.ref''').fetchall()
        assert actual==[('pending',0,'pending'),('approved',10,'approved'),('cancelled',0,'rejected')],actual
        con.execute('UPDATE PurchaseRequestLine SET approvedQty=7,approvalDecision="reduced" WHERE id=(SELECT l.id FROM PurchaseRequestLine l JOIN PurchaseRequest r ON r.id=l.requestId WHERE r.ref="QA-P5150-2")')
        con.commit()
    migration.upgrade(db)
    with closing(sqlite3.connect(db)) as con:
        qty=con.execute('''SELECT l.approvedQty FROM PurchaseRequestLine l
          JOIN PurchaseRequest r ON r.id=l.requestId WHERE r.ref='QA-P5150-2' ''').fetchone()[0]
        assert qty==7,'Migration non idempotente, a écrasé une décision existante'
        before_users=con.execute('SELECT COUNT(*) FROM GoCmdUser').fetchone()[0]
        before_material_refs={r[0] for r in con.execute('SELECT ref FROM Material')}
        before_products=con.execute('SELECT COUNT(*) FROM Product').fetchone()[0]
        con.execute('INSERT INTO AuditEvent(actor,action,entity,entityId,details) VALUES(?,?,?,?,?)',('demo_admin','USER_ROLE_UPDATED','GoCmdUser','test','synthetic'))
        con.commit()
    # Le reset destructif historique DOIT être refusé par les gardes de
    # rétention P5.15.23. La reconstruction DEMO complète est contrôlée
    # séparément par test_p51523_demo_reseed.py. Ne jamais désactiver les gardes.
    try:
        preparation.prepare(db)
    except sqlite3.IntegrityError as exc:
        assert 'GOCMD_HISTORICAL_DELETE_FORBIDDEN' in str(exc),exc
    else:
        raise AssertionError('Le reset legacy a effacé un historique protégé')
    with closing(sqlite3.connect(db)) as con:
        assert con.execute('SELECT COUNT(*) FROM PurchaseRequest').fetchone()[0]==3
        assert con.execute('SELECT COUNT(*) FROM SupplierConsultation').fetchone()[0]==0
        assert con.execute('SELECT COUNT(*) FROM SupplierOrder').fetchone()[0]==0
        assert con.execute('SELECT COUNT(*) FROM GoCmdUser').fetchone()[0]==before_users
        assert con.execute('SELECT COUNT(*) FROM Product').fetchone()[0]==before_products
        assert con.execute('SELECT COUNT(*) FROM AuditEvent WHERE action="USER_ROLE_UPDATED"').fetchone()[0]==1
        assert before_material_refs.issubset({r[0] for r in con.execute('SELECT ref FROM Material')}), 'References historiques supprimees'
        assert con.execute('PRAGMA integrity_check').fetchone()[0][0:2]=='ok'
        assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
        cols={x[1] for x in con.execute('PRAGMA table_info("PurchaseRequestLine")')}
        assert set(migration.FIELDS).issubset(cols)
print('PASS P5.15.0 : migration idempotente, décisions historiques, reset legacy destructif bloqué sur copie, données utilisateurs/ventes et audit droits conservés, stock/FK OK.')
