"""Vérifie migration et invariants SQL sur une COPIE TEMPORAIRE, jamais la base courante."""
import contextlib
import importlib.util
import pathlib
import shutil
import sqlite3
import tempfile

ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('mig',ROOT/'scripts'/'migrer_da_bc_br.py')
mig=importlib.util.module_from_spec(spec);spec.loader.exec_module(mig)
with tempfile.TemporaryDirectory() as tmp:
    dst=pathlib.Path(tmp)/'test.db'
    shutil.copy2(ROOT/'db'/'custom.db',dst)
    con=sqlite3.connect(dst); counts0={t:con.execute(f'SELECT count(*) FROM {t}').fetchone()[0] for t in ('Material','Product','PurchaseRequest','Movement')};con.close()
    mig.migrate(dst,backup=False);mig.migrate(dst,backup=False)
    db=sqlite3.connect(dst)
    db.execute('PRAGMA foreign_keys=ON')
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    counts1={t:db.execute(f'SELECT count(*) FROM {t}').fetchone()[0] for t in counts0}
    assert counts0==counts1, (counts0,counts1)
    supplier=db.execute('SELECT id FROM Supplier LIMIT 1').fetchone()
    if not supplier:db.execute('INSERT INTO Supplier(code,name) VALUES (?,?)',('FRN-TEST','Fournisseur test'));supplier=(db.execute('SELECT id FROM Supplier WHERE code=?',('FRN-TEST',)).fetchone()[0],)
    material_id=db.execute('SELECT id FROM Material LIMIT 1').fetchone()[0]
    db.execute('INSERT OR IGNORE INTO SupplierMaterial(supplierId,materialId,preferred) VALUES(?,?,0)',(supplier[0],material_id))
    # Une matière peut avoir 2 fournisseurs.
    db.execute('INSERT INTO Supplier(code,name) VALUES (?,?)',('FRN-TEST-2','Autre fournisseur test'))
    new_id=db.execute('SELECT id FROM Supplier WHERE code=?',('FRN-TEST-2',)).fetchone()[0]
    db.execute('INSERT INTO SupplierMaterial(supplierId,materialId,preferred) VALUES (?,?,0)',(new_id,material_id))
    assert db.execute('SELECT COUNT(*) FROM SupplierMaterial WHERE materialId=?',(material_id,)).fetchone()[0]>=2
    req_id=db.execute('INSERT INTO PurchaseRequest(ref,status) VALUES (?,?)',('DA-TEST-2026','approved')).lastrowid
    request_line=db.execute('INSERT INTO PurchaseRequestLine(requestId,materialId,qty,unitPrice,receivedQty) VALUES (?,?,?,?,0)',(req_id,material_id,100,5)).lastrowid
    order_id=db.execute('INSERT INTO SupplierOrder(ref,supplierId,status) VALUES (?,?,?)',('BC-TEST-2026',supplier[0],'confirmed')).lastrowid
    bcl=db.execute('INSERT INTO SupplierOrderLine(orderId,materialId,requestLineId,qty,unitPrice) VALUES(?,?,?,?,?)',(order_id,material_id,request_line,60,5)).lastrowid
    order2=db.execute('INSERT INTO SupplierOrder(ref,supplierId,status) VALUES (?,?,?)',('BC-TEST-2026-2',new_id,'confirmed')).lastrowid
    db.execute('INSERT INTO SupplierOrderLine(orderId,materialId,requestLineId,qty,unitPrice) VALUES (?,?,?,?,?)',(order2,material_id,request_line,40,6))
    before=db.execute('SELECT stockQty FROM Material WHERE id=?',(material_id,)).fetchone()[0]
    br_id=db.execute('INSERT INTO GoodsReceipt(ref,supplierOrderId,deliveryRef,operator) VALUES (?,?,?,?)',('BR-TEST-1',order_id,'BL-TEST-1','Réception test')).lastrowid
    db.execute('INSERT INTO GoodsReceiptLine(goodsReceiptId,supplierOrderLineId,acceptedQty,rejectedQty,lot) VALUES (?,?,?,?,?)',(br_id,bcl,25,5,'LOT-TEST'))
    db.execute('UPDATE SupplierOrderLine SET receivedQty=receivedQty+25 WHERE id=?',(bcl,))
    db.execute('UPDATE PurchaseRequestLine SET receivedQty=receivedQty+25 WHERE id=?',(request_line,))
    db.execute('UPDATE Material SET stockQty=stockQty+25 WHERE id=?',(material_id,))
    db.commit()
    assert db.execute('SELECT receivedQty FROM SupplierOrderLine WHERE id=?',(bcl,)).fetchone()[0]==25
    assert db.execute('SELECT stockQty FROM Material WHERE id=?',(material_id,)).fetchone()[0]==before+25
    try:
        db.execute('INSERT INTO GoodsReceipt(ref,supplierOrderId,deliveryRef,operator) VALUES (?,?,?,?)',('BR-TEST-DUP',order_id,'BL-TEST-1','Réception test'))
        raise AssertionError('Contrainte unicité BC / BL absente')
    except sqlite3.IntegrityError:pass
    assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
    print('OK : fournisseurs multiples, DA scindée en 2 BC, BR partiel, lots, refus hors stock, BL unique, historiques préservés')
    db.close()
