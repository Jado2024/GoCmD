"""V0.7 isolated SQLite guarantees for BR provenance and return balances.
These are database contract tests only, not HTTP/browser/Prisma E2E.
"""
import sqlite3,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
original=sqlite3.connect(root/'db/custom.db')
db=sqlite3.connect(':memory:');original.backup(db);original.close()
db.execute('PRAGMA foreign_keys=ON')
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
cols={x[1] for x in db.execute('PRAGMA table_info(GoodsReceiptLine)')}
assert 'returnedQty' in cols
lotcols={x[1] for x in db.execute('PRAGMA table_info(StockLot)')}
assert 'provenanceKey' in lotcols
supplier=db.execute('SELECT id FROM Supplier ORDER BY id LIMIT 1').fetchone()[0]
material=db.execute('SELECT id FROM Material ORDER BY id LIMIT 1').fetchone()[0]
db.execute("INSERT INTO SupplierOrder(ref,supplierId,status) VALUES('BC-V07',?,'confirmed')",(supplier,))
bc=db.execute('SELECT last_insert_rowid()').fetchone()[0]
db.execute('INSERT INTO SupplierOrderLine(orderId,materialId,qty,receivedQty,unitPrice) VALUES(?,?,20,15,100)',(bc,material))
line=db.execute('SELECT last_insert_rowid()').fetchone()[0]
for x in (1,2):
 db.execute('INSERT INTO GoodsReceipt(ref,supplierOrderId,deliveryRef,operator) VALUES(?,?,?,?)',(f'BR-V07-{x}',bc,f'BL-V07-{x}','tester'))
 br=db.execute('SELECT last_insert_rowid()').fetchone()[0]
 db.execute('INSERT INTO GoodsReceiptLine(goodsReceiptId,supplierOrderLineId,acceptedQty,rejectedQty,lot) VALUES(?,?,?,0,?)',(br,line,10 if x==1 else 5,'LOT-COMMUN'))
 rl=db.execute('SELECT last_insert_rowid()').fetchone()[0]
 db.execute('INSERT INTO StockLot(materialId,lotCode,status,qty,supplierId,receiptLineId,provenanceKey) VALUES(?,?,\'available\',?,?,?,?)',(material,'LOT-COMMUN',10 if x==1 else 5,supplier,rl,f'BRL-{rl}'))
assert db.execute("SELECT count(*) FROM StockLot WHERE lotCode='LOT-COMMUN' AND status='available'").fetchone()[0]==2
rows=db.execute("SELECT id,receiptLineId,provenanceKey FROM StockLot WHERE lotCode='LOT-COMMUN' AND status='available' ORDER BY id").fetchall()
assert rows[0][2] != rows[1][2]
try:
 db.execute('INSERT INTO StockLot(materialId,lotCode,status,qty,supplierId,receiptLineId,provenanceKey) VALUES(?,?,\'available\',5,?,?,?)',(material,'LOT-COMMUN',supplier,rows[0][1],rows[0][2]))
 raise AssertionError('double origin should violate unique index')
except sqlite3.IntegrityError: pass
# One physical batch split by quality state keeps the same source identity.
db.execute("INSERT INTO StockLot(materialId,lotCode,status,qty,supplierId,receiptLineId,provenanceKey) VALUES(?,?,\'quarantine\',5,?,?,?)",(material,'LOT-COMMUN',supplier,rows[0][1],rows[0][2]))
assert db.execute("SELECT count(*) FROM StockLot WHERE lotCode='LOT-COMMUN' AND provenanceKey=?",(rows[0][2],)).fetchone()[0]==2
# A return is a separate counter and cannot silently change gross received stock.
rl=rows[0][1]
db.execute('UPDATE GoodsReceiptLine SET returnedQty=returnedQty+4 WHERE id=? AND acceptedQty-returnedQty>=4',(rl,))
assert db.execute('SELECT acceptedQty,returnedQty FROM GoodsReceiptLine WHERE id=?',(rl,)).fetchone()==(10.0,4.0)
assert db.execute('SELECT acceptedQty-returnedQty FROM GoodsReceiptLine WHERE id=?',(rl,)).fetchone()[0]==6.0
assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
print('PASS V07: 7 contrôles SQL sur provenance BR, même lot multi-BR, unicité, statut qualité et retour net')
