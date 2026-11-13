"""Real SQLite exercises against an isolated copy of the supplied SODEPI demo database."""
from pathlib import Path
from tempfile import TemporaryDirectory
import importlib.util
import sqlite3
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('invoice_guards',ROOT/'scripts/upgrade_invoice_immutability_p51523.py')
g=importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
with TemporaryDirectory() as temp_name:
    temp=Path(temp_name)
    copy=temp/'data'/'demo.db';copy.parent.mkdir()
    with sqlite3.connect(f'file:{(ROOT/"db/custom.db").resolve()}?mode=ro',uri=True) as source, sqlite3.connect(copy) as dest:
        source.backup(dest)
    baseline=(ROOT/'db/custom.db').read_bytes()
    g.run(copy,None,False)
    try:
        g.run(copy,None,True)
        raise AssertionError('missing backup was not blocked')
    except ValueError:pass
    g.run(copy,temp/'external'/'original.db',True)
    with sqlite3.connect(copy) as db:
        count=db.execute('SELECT COUNT(*) FROM sqlite_master WHERE type="trigger" AND name LIKE "gocmd_invoice_lock_%"').fetchone()[0]
        assert count==6,count
        # Real DB tables are present, but demo reset intentionally contains no sales orders or invoices.
        # Insert self-contained invoice rows within an isolated DB with foreign key checks temporarily off.
        db.execute('PRAGMA foreign_keys=OFF')
        db.execute('INSERT INTO SalesInvoice(ref,orderId,clientId,currency,subtotalCents,taxCents,totalCents,createdBy,issuedAt) VALUES(?,?,?,?,?,?,?,?,?)',('TEST_IMMUTABLE',9876543,9876543,'MAD',10000,2000,12000,'test','2026-11-09 00:00:00'))
        inv=db.execute('SELECT id FROM SalesInvoice WHERE ref=?',('TEST_IMMUTABLE',)).fetchone()[0]
        db.execute('INSERT INTO SalesInvoiceLine(invoiceId,deliveryLineId,qty,unit,unitPriceCents,amountCents) VALUES(?,?,?,?,?,?)',(inv,9876543,2,'u',5000,10000))
        def blocked(sql,params=()):
            try:db.execute(sql,params)
            except sqlite3.IntegrityError as exc:
                assert ('GOCMD_INVOICE_' in str(exc) or ('DELETE FROM' in sql and 'GOCMD_HISTORICAL_DELETE_FORBIDDEN' in str(exc))),(sql,exc)
                return
            raise AssertionError('invoice mutation not blocked: '+sql)
        blocked('UPDATE SalesInvoice SET totalCents=1 WHERE id=?',(inv,))
        blocked('UPDATE SalesInvoice SET taxRateBps=200 WHERE id=?',(inv,))
        blocked('UPDATE SalesInvoiceLine SET qty=9 WHERE invoiceId=?',(inv,))
        blocked('DELETE FROM SalesInvoiceLine WHERE invoiceId=?',(inv,))
        db.execute('UPDATE SalesInvoice SET status=?,version=version+1 WHERE id=?',('partial',inv))
        assert db.execute('SELECT status,version,totalCents FROM SalesInvoice WHERE id=?',(inv,)).fetchone()==('partial',1,12000)
        db.execute('INSERT INTO SupplierInvoice(supplierId,invoiceNumber,invoiceDate,status,totalAmount,createdBy,createdAt) VALUES(?,?,?,?,?,?,?)',(9876543,'TEST_IMMUTABLE','2026-11-09','approved',300,'test','2026-11-09'))
        sup=db.execute('SELECT id FROM SupplierInvoice WHERE invoiceNumber=?',('TEST_IMMUTABLE',)).fetchone()[0]
        db.execute('INSERT INTO SupplierInvoiceLine(invoiceId,orderLineId,qty,unitPrice,taxRate) VALUES(?,?,?,?,?)',(sup,9876543,3,100,0))
        blocked('UPDATE SupplierInvoice SET totalAmount=1 WHERE id=?',(sup,))
        blocked('UPDATE SupplierInvoiceLine SET unitPrice=1 WHERE invoiceId=?',(sup,))
        blocked('DELETE FROM SupplierInvoiceLine WHERE invoiceId=?',(sup,))
        db.execute('UPDATE SupplierInvoice SET version=version+1,status=? WHERE id=?',('paid',sup))
        assert db.execute('SELECT status,version FROM SupplierInvoice WHERE id=?',(sup,)).fetchone()==('paid',1)
        db.rollback()  # test fixtures never persist
    g.run(copy,temp/'external'/'original2.db',True)
    assert (ROOT/'db/custom.db').read_bytes()==baseline
print('PASS: invoice monetary fields and lines are immutable; status/payment versions still writable; migration backed up and idempotent')
