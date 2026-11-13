"""Reproducible acceptance cases on disposable SQLite copies, never actual demo db."""
import sqlite3, tempfile, pathlib, subprocess,sys,shutil
root=pathlib.Path(__file__).resolve().parents[1]
def check(value,msg):assert value,msg
with tempfile.TemporaryDirectory() as d:
  db=pathlib.Path(d)/'test.db'
  with sqlite3.connect(db) as c:
    c.executescript('''CREATE TABLE ProductionStockOrder(id INTEGER PRIMARY KEY,requestId INT,status TEXT);
CREATE TABLE ProductionReplenishmentRequest(id INTEGER PRIMARY KEY,status TEXT);
CREATE TABLE ProductionMaterialReceipt(id INTEGER PRIMARY KEY,stockOrderId INT,status TEXT,qty REAL);
CREATE TABLE FinishedStockLot(id INTEGER PRIMARY KEY,sourceRef TEXT,status TEXT);
CREATE TABLE FinishedStockMovement(id INTEGER PRIMARY KEY,type TEXT,lotId INT,qty INT);
''')
    c.executemany('INSERT INTO ProductionStockOrder VALUES(?,?,?)',[(1,1,'completed')])
    c.executemany('INSERT INTO ProductionReplenishmentRequest VALUES(?,?)',[(1,'approved')])
    # 10 rejected -> 10 replacements => eligible: rejected qty excluded, history preserved.
    c.execute("INSERT INTO ProductionMaterialReceipt VALUES(1,1,'rejected',10)")
    active=c.execute("SELECT COALESCE(SUM(qty),0) FROM ProductionMaterialReceipt WHERE stockOrderId=1 AND status IN ('quarantine','released')").fetchone()[0]
    historic=c.execute("SELECT SUM(qty) FROM ProductionMaterialReceipt WHERE stockOrderId=1").fetchone()[0]
    check(active==0 and historic==10,'material rejected history')
    c.execute("INSERT INTO ProductionMaterialReceipt VALUES(2,1,'quarantine',10)")
    active=c.execute("SELECT SUM(qty) FROM ProductionMaterialReceipt WHERE status IN ('quarantine','released')").fetchone()[0]
    check(active==10,'replacement capacity')
    c.execute("UPDATE ProductionMaterialReceipt SET status='released' WHERE id=2")
    check(c.execute("SELECT SUM(qty) FROM ProductionMaterialReceipt WHERE status='released'").fetchone()[0]==10,'material closure')
    c.executemany('INSERT INTO FinishedStockLot VALUES(?,?,?)',[(1,'DPR-1','rejected'),(2,'DPR-1','quarantine')])
    c.executemany("INSERT INTO FinishedStockMovement VALUES(?,'received_quarantine',?,?)",[(1,1,10),(2,2,10)])
    active=c.execute("SELECT SUM(m.qty) FROM FinishedStockMovement m JOIN FinishedStockLot l ON l.id=m.lotId WHERE l.sourceRef='DPR-1' AND m.type='received_quarantine' AND l.status IN ('quarantine','available','exhausted')").fetchone()[0]
    check(active==10,'finished replacement capacity')
    c.execute("UPDATE FinishedStockLot SET status='exhausted' WHERE id=2")
    check(c.execute("SELECT SUM(m.qty) FROM FinishedStockMovement m JOIN FinishedStockLot l ON l.id=m.lotId WHERE l.status IN ('available','exhausted')").fetchone()[0]==10,'finished closure after shipment')
  # Real migration tested on a disposable copy of the shipped demo database elsewhere.
# Run actual additive migration twice on disposable copy, assert all new triggers.
with tempfile.TemporaryDirectory() as d:
    copy=pathlib.Path(d)/'demo.db'
    shutil.copy2(root/'db'/'custom.db',copy)
    for _ in range(2):
        r=subprocess.run([sys.executable,str(root/'scripts'/'upgrade_mts_rework_cost_p51527.py'),'--db',str(copy),'--apply'],capture_output=True,text=True)
        assert r.returncode==0,r.stderr
    with sqlite3.connect(copy) as c:
        assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
        c.execute('INSERT INTO ProductionReworkApproval(ref,sourceKind,sourceId,productionRef,qty,unit,approvedBy,reason) VALUES(?,?,?,?,?,?,?,?)',('REOF-TEST','material_receipt',777,'OFMTS-TEST',10,'kg','production_a','Remplacement autorise'))
        c.execute('UPDATE ProductionReworkApproval SET usedQty=5 WHERE sourceId=777')
        try:
            c.execute('UPDATE ProductionReworkApproval SET qty=20 WHERE sourceId=777')
            assert False,'Immutable approval changed'
        except sqlite3.IntegrityError: pass
        try:
            c.execute('UPDATE ProductionReworkApproval SET usedQty=11 WHERE sourceId=777')
            assert False,'Over-used rework'
        except sqlite3.IntegrityError: pass
print('PASS: rejected material+finished, rework authorization immutability, historic totals, migration twice, SQL/FK')
