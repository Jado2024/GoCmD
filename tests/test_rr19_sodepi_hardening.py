#!/usr/bin/env python3
"""RR-06/RR-08/RR-10/RR-18 guards + SQLite reservation contract.

This test exercises real SQLite triggers on a disposable backup. It also checks
that the work-order and sale routes are wired to the required guards; it is NOT
an HTTP / Playwright substitute.
"""
from pathlib import Path
import sqlite3
import tempfile
import unittest
import importlib.util
import datetime as dt
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]

class TestRR19(unittest.TestCase):
    def test_material_stock_reservation_sqlite_cannot_double_book(self):
        with tempfile.TemporaryDirectory() as directory:
            clone=Path(directory)/'isolated.db'
            with sqlite3.connect(f'file:{(ROOT/"db/custom.db").resolve()}?mode=ro',uri=True) as source, sqlite3.connect(clone) as dest:
                source.backup(dest)
            with sqlite3.connect(clone) as db:
                db.execute('PRAGMA foreign_keys=ON')
                db.execute('BEGIN IMMEDIATE')
                lot=db.execute("SELECT id, materialId,qty FROM StockLot WHERE status='available' AND qty>=2 ORDER BY id LIMIT 1").fetchone()
                self.assertIsNotNone(lot)
                lot_id,material_id,stock=lot
                product=db.execute('SELECT id,unit,unitPrice FROM Product WHERE materialId=? AND status="active" LIMIT 1',(material_id,)).fetchone()
                self.assertIsNotNone(product)
                pid,unit,price=product
                client=db.execute('SELECT id FROM Client LIMIT 1').fetchone()[0]
                lineids=[]
                for i in range(2):
                    order=db.execute('INSERT INTO "Order"(ref,clientId,status,createdBy) VALUES (?,?,?,?)',
                                     (f'TEST-RR19-{i}',client,'new','TEST')).lastrowid
                    lid=db.execute('INSERT INTO OrderLine(orderId,productId,qty,unit,unitPrice,stockUnit,stockUnitsPerSale) VALUES (?,?,?,?,?,?,?)',
                                   (order,pid,stock,unit,price,unit,1)).lastrowid
                    lineids.append(lid)
                db.execute('INSERT INTO SalesStockReservation(orderLineId,stockLotId,qty,createdBy) VALUES (?,?,?,?)',
                           (lineids[0],lot_id,stock,'TEST'))
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute('INSERT INTO SalesStockReservation(orderLineId,stockLotId,qty,createdBy) VALUES (?,?,?,?)',
                               (lineids[1],lot_id,stock,'TEST'))
                db.execute('DELETE FROM SalesStockReservation WHERE orderLineId=?',(lineids[0],))
                db.execute('INSERT INTO SalesStockReservation(orderLineId,stockLotId,qty,createdBy) VALUES (?,?,?,?)',
                           (lineids[1],lot_id,stock,'TEST'))
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
                db.rollback()

    def test_ttl_never_orphans_prepared_work_order(self):
        path=ROOT/'scripts/expire_sales_reservations_p51521.py'
        spec=importlib.util.spec_from_file_location('rr19_expire',path)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        now=dt.datetime.now(dt.timezone.utc)
        old=(now-dt.timedelta(hours=4)).isoformat()
        with tempfile.TemporaryDirectory() as directory:
            dbfile=Path(directory)/'expiry.db'
            with sqlite3.connect(dbfile) as db:
                db.executescript('''
                CREATE TABLE SalesStockReservation(id INTEGER PRIMARY KEY,orderLineId INTEGER,stockLotId INTEGER,qty REAL,createdBy TEXT,updatedAt TEXT);
                CREATE TABLE WorkOrder(orderLineId INTEGER,status TEXT,preparationKind TEXT);
                CREATE TABLE AuditEvent(actor TEXT,action TEXT,entity TEXT,entityId TEXT,details TEXT,createdAt INTEGER);
                ''')
                db.executemany('INSERT INTO SalesStockReservation VALUES(?,?,?,?,?,?)',[(1,1,11,4,'mag',old),(2,2,12,3,'mag',old)])
                db.execute("INSERT INTO WorkOrder VALUES(1,'completed','stock')")
                db.commit()
            with patch.dict('os.environ',{'GOCMD_RESERVATION_TTL_HOURS':'2','GOCMD_RESERVATION_WARNING_HOURS':'1'}):
                outcome=module.run(dbfile,True,now=now)
            self.assertEqual(outcome['expiredIds'],[2])
            self.assertEqual(outcome['blockedByPreparedOfIds'],[1])
            with sqlite3.connect(dbfile) as db:
                self.assertEqual(db.execute('SELECT id FROM SalesStockReservation').fetchall(),[(1,)])
                self.assertEqual(db.execute('SELECT COUNT(*) FROM AuditEvent').fetchone()[0],1)

    def test_preparation_and_cancellation_own_material_reservations(self):
        source=(ROOT/'src/app/api/work-orders/[id]/route.ts').read_text()
        self.assertIn('await tx.salesStockReservation.create({data:{orderLineId:line.id',source)
        self.assertIn('await tx.salesStockReservation.deleteMany({where:{orderLineId:item.orderLineId}})',source)
        self.assertIn('orderBy:[{expiresAt:{sort:"asc",nulls:"last"}}',source)
        sales=(ROOT/'src/app/api/sales/route.ts').read_text()
        self.assertIn('Réservation verrouillée par un OF préparé',sales)

    def test_policy_and_privacy_wiring(self):
        invoice=(ROOT/'src/app/api/supplier-invoices/route.ts').read_text()
        self.assertIn('const storedPrice=Number(item.unitPrice.toFixed(4))',invoice)
        self.assertIn('supplierInvoicePolicyIssues(',invoice)
        alerts=(ROOT/'src/app/api/sales/reservation-alerts/route.ts').read_text()
        self.assertIn('finishedItems',alerts)
        movements=(ROOT/'src/app/api/movements/route.ts').read_text()
        self.assertIn('operator:canReadOperators?m.operator:null',movements)
        self.assertIn('"Cache-Control":"private, no-store"',movements)
        dashboard=(ROOT/'src/app/api/dashboard/route.ts').read_text()
        self.assertIn('actor.roles.some(role=>["admin","inventory","approver","buyer","finance"].includes(role))',dashboard)

if __name__=='__main__': unittest.main(verbosity=2)
