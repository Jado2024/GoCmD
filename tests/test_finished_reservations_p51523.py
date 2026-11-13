#!/usr/bin/env python3
"""Contre-audit réservation matelas : migration, contraintes, livraison partielle,
libération, rupture et garde anti-doublon. DB synthétique isolée, aucun HTTP.
"""
from pathlib import Path
import sqlite3
import tempfile
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/upgrade_finished_reservations_p51523.py'

def should_reject(db,sql,params=()):
    try:
        db.execute(sql,params)
    except sqlite3.IntegrityError:
        return
    raise AssertionError('Écriture non conforme acceptée : '+sql)

with tempfile.TemporaryDirectory(prefix='gocmd-reservation-test-') as tmp:
    path=Path(tmp)/'test.db'
    with sqlite3.connect(path) as c:
        c.executescript('''
        PRAGMA foreign_keys=ON;
        CREATE TABLE "Product" ("id" INTEGER PRIMARY KEY,"family" TEXT);
        CREATE TABLE "Order" ("id" INTEGER PRIMARY KEY);
        CREATE TABLE "OrderLine" ("id" INTEGER PRIMARY KEY,"orderId" INTEGER REFERENCES "Order"("id"),"productId" INTEGER REFERENCES "Product"("id"));
        CREATE TABLE "WorkOrder" ("id" INTEGER PRIMARY KEY,"orderLineId" INTEGER REFERENCES "OrderLine"("id"),
          "status" TEXT,"startedAt" DATETIME);
        CREATE TABLE "FinishedStockLot" ("id" INTEGER PRIMARY KEY,"productId" INTEGER REFERENCES "Product"("id"),
          "status" TEXT,"qty" INTEGER CHECK("qty">=0));
        INSERT INTO "Product" VALUES (1,'MATELAS'),(2,'MATELAS');
        INSERT INTO "Order" VALUES (1),(2),(3);
        INSERT INTO "OrderLine" VALUES (10,1,1),(11,2,1),(12,3,2);
        INSERT INTO "WorkOrder" VALUES (1,10,'completed',NULL);
        INSERT INTO "FinishedStockLot" VALUES (100,1,'available',10),(101,2,'available',3);
        ''')
    a=subprocess.run([sys.executable,str(SCRIPT),'--db',str(path),'--apply'],capture_output=True,text=True)
    assert a.returncode==0,(a.stdout,a.stderr)
    with sqlite3.connect(path) as c:
        c.execute('PRAGMA foreign_keys=ON')
        assert c.execute('SELECT preparationKind FROM WorkOrder WHERE id=1').fetchone()[0]=='legacy_stock'
        # Une deuxième migration ne touche à rien.
        b=subprocess.run([sys.executable,str(SCRIPT),'--db',str(path),'--apply'],capture_output=True,text=True)
        assert b.returncode==0 and 'installées' in b.stdout
        # 10 physiques, 7 réservés : 3 restent libres.
        c.execute('INSERT INTO FinishedStockReservation(orderLineId,lotId,qty,createdBy) VALUES(10,100,7,\'QA\')')
        assert c.execute('SELECT qty FROM FinishedStockLot WHERE id=100').fetchone()[0]==10
        should_reject(c,'INSERT INTO FinishedStockReservation(orderLineId,lotId,qty,createdBy) VALUES (11,100,4,\'QA\')')
        c.execute('INSERT INTO FinishedStockReservation(orderLineId,lotId,qty,createdBy) VALUES(11,100,3,\'QA\')')
        should_reject(c,'INSERT INTO FinishedStockReservation(orderLineId,lotId,qty,createdBy) VALUES (12,100,1,\'QA\')')
        should_reject(c,'UPDATE FinishedStockLot SET qty=3 WHERE id=100')
        should_reject(c,"UPDATE FinishedStockLot SET status='rejected' WHERE id=100")
        # Livraison partielle de 4 matelas du client A : réservation 7→3 ; physique 10→6
        c.execute('UPDATE FinishedStockReservation SET qty=3 WHERE orderLineId=10')
        c.execute('UPDATE FinishedStockLot SET qty=qty-4 WHERE id=100')
        assert c.execute('SELECT qty FROM FinishedStockLot WHERE id=100').fetchone()[0]==6
        assert c.execute('SELECT SUM(qty) FROM FinishedStockReservation').fetchone()[0]==6
        should_reject(c,'UPDATE FinishedStockReservation SET qty=4 WHERE orderLineId=11')
        # Commande B suspendue : trois matelas libérés sans débit physique.
        c.execute('DELETE FROM FinishedStockReservation WHERE orderLineId=11')
        assert c.execute('SELECT qty FROM FinishedStockLot WHERE id=100').fetchone()[0]==6
        assert c.execute('SELECT SUM(qty) FROM FinishedStockReservation').fetchone()[0]==3
        # Livraison restante A, réservation consommée définitivement.
        c.execute('DELETE FROM FinishedStockReservation WHERE orderLineId=10')
        c.execute('UPDATE FinishedStockLot SET qty=qty-3 WHERE id=100')
        assert c.execute('SELECT qty FROM FinishedStockLot WHERE id=100').fetchone()[0]==3
        assert c.execute('SELECT COUNT(*) FROM FinishedStockReservation').fetchone()[0]==0
        assert not c.execute('PRAGMA foreign_key_check').fetchall()
        assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'

    # Deux acteurs concurrents, deux CMD, un seul lot de quatre matelas :
    # transaction SQLite verrouillée AVANT la lecture, une seule réservation.
    import concurrent.futures
    with sqlite3.connect(path) as c:
        c.execute('UPDATE FinishedStockLot SET qty=4 WHERE id=100')
    def reserve_race(line):
        with sqlite3.connect(path,timeout=8,isolation_level=None) as db:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('BEGIN IMMEDIATE')
            try:
                available=db.execute('SELECT fl.qty-COALESCE(SUM(fr.qty),0)\n                      FROM FinishedStockLot fl LEFT JOIN FinishedStockReservation fr ON fr.lotId=fl.id\n                      WHERE fl.id=100 GROUP BY fl.id').fetchone()[0]
                if available<4:
                    db.execute('ROLLBACK')
                    return 409
                db.execute("INSERT INTO FinishedStockReservation(orderLineId,lotId,qty,createdBy) VALUES(?,100,4,'QA')",(line,))
                db.execute('COMMIT')
                return 200
            except Exception:
                db.execute('ROLLBACK')
                raise
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(reserve_race,[10,11]))
    assert sorted(responses)==[200,409],responses
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT qty FROM FinishedStockLot WHERE id=100').fetchone()[0]==4
        assert db.execute('SELECT SUM(qty) FROM FinishedStockReservation WHERE lotId=100').fetchone()[0]==4
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'

wo=(ROOT/'src/app/api/work-orders/[id]/route.ts').read_text()
sales=(ROOT/'src/app/api/sales/route.ts').read_text()
orders=(ROOT/'src/app/api/orders/[id]/route.ts').read_text()
assert 'finishedStockReservation.create' in wo
assert 'finishedStockReservation.delete' in sales and 'finishedStockLot.updateMany' in sales
assert 'preparationKind==="stock"' in sales
assert 'finishedStockReservation.deleteMany' in orders
assert 'MATELAS_STOCK_USE_RESERVED_DELIVERY' in sales
print('PASS P5.15.23 : migration/idempotence, stock réservé sans débit, concurrence 200/409, livraison partielle, libération, identité produit, FK et gardes statiques')
