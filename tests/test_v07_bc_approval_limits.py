"""SQL simulation of DA commitment at BC approval; validates the V0.7 rule.
Does NOT execute the Prisma API route. Test data lives only in memory.
"""
import sqlite3,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
source=sqlite3.connect(root/'db/custom.db')
c=sqlite3.connect(':memory:');source.backup(c);source.close();c.execute('PRAGMA foreign_keys=ON')
supplier=c.execute('SELECT id FROM Supplier LIMIT 1').fetchone()[0]
material=c.execute('SELECT id FROM Material LIMIT 1').fetchone()[0]
c.execute("INSERT INTO PurchaseRequest(ref,status) VALUES('DA-V07-LIMIT','approved')")
da=c.execute('SELECT last_insert_rowid()').fetchone()[0]
c.execute('INSERT INTO PurchaseRequestLine(requestId,materialId,qty,receivedQty) VALUES(?,?,100,0)',(da,material))
line=c.execute('SELECT last_insert_rowid()').fetchone()[0]
def draft(ref,qty):
 c.execute("INSERT INTO SupplierOrder(ref,supplierId,status,createdBy) VALUES(?,?,'draft','buyer-test')",(ref,supplier))
 order=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 c.execute('INSERT INTO SupplierOrderLine(orderId,materialId,requestLineId,qty,receivedQty,unitPrice) VALUES(?,?,?,?,0,25)',(order,material,line,qty))
 return order
def approve(order):
 demand=c.execute('SELECT qty,receivedQty FROM PurchaseRequestLine WHERE id=?',(line,)).fetchone()
 others=c.execute("""SELECT COALESCE(SUM(l.qty),0),COALESCE(SUM(l.receivedQty),0)
 FROM SupplierOrderLine l JOIN SupplierOrder o ON o.id=l.orderId
 WHERE l.requestLineId=? AND o.id<>? AND o.status IN ('confirmed','partial','received')""",(line,order)).fetchone()
 qty=c.execute('SELECT qty FROM SupplierOrderLine WHERE orderId=?',(order,)).fetchone()[0]
 available=demand[0] - (demand[1]-others[1]) - others[0]
 if qty>available+1e-6:return False
 c.execute("UPDATE SupplierOrder SET status='confirmed',approvedBy='approver-test' WHERE id=? AND status='draft'",(order,))
 return bool(c.execute('SELECT changes()').fetchone()[0])
a=draft('BC-V07-A',60)
b=draft('BC-V07-B',60)
assert approve(a)
assert not approve(b), 'second draft must not overcommit 100-unit DA'
assert c.execute('SELECT status FROM SupplierOrder WHERE id=?',(b,)).fetchone()[0]=='draft'
third=draft('BC-V07-C',40)
assert approve(third)
assert c.execute("SELECT sum(l.qty) FROM SupplierOrderLine l JOIN SupplierOrder o ON o.id=l.orderId WHERE l.requestLineId=? AND o.status='confirmed'",(line,)).fetchone()[0]==100
assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
print('PASS V07: 5 SQL assertions, BC draft 60+60 : second blocked; BC 40 authorized without overcommit')
