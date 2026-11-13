#!/usr/bin/env python3
"""Cascade 2 — functional re-audit of historical engagedAt SQLite drift.

All tests are on disposable DB copies, and must assert the actual SQL effect
rather than merely finding strings in source files.
"""
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'db' / 'custom.db'
MIGRATOR = ROOT / 'scripts' / 'upgrade_reservation_engagement_p6.py'
TRIGGERS = ('gocmd_p6_engagement_default_insert','gocmd_p6_engagement_immutable_update')
CHECKS = 0

def check(expr, desc):
    global CHECKS
    CHECKS += 1
    if not expr:
        raise AssertionError(desc)

def fixture(con):
    client = con.execute('SELECT id FROM Client LIMIT 1').fetchone()[0]
    item = con.execute('''SELECT p.id,m.id,p.unit,m.unit FROM Product p
         JOIN Material m ON m.id=p.materialId WHERE m.isSellable=1
         AND EXISTS(SELECT 1 FROM StockLot s WHERE s.materialId=m.id
           AND s.status='available' AND s.qty>=5) LIMIT 1''').fetchone()
    assert item, 'négoce fixture material missing'
    pid,mid,unit,stock_unit = item
    lot = con.execute('SELECT id FROM StockLot WHERE materialId=? AND status=\'available\' AND qty>=5 LIMIT 1',(mid,)).fetchone()[0]
    con.execute('''INSERT INTO "Order"(ref,clientId,status,priority,createdBy,dueDate,createdAt)
               VALUES ('CMD-CASCADE2-ENGAGED',?,'ready','normale','audit','2026-12-01','2026-11-01')''',(client,))
    oid=con.execute("SELECT id FROM 'Order' WHERE ref='CMD-CASCADE2-ENGAGED'").fetchone()[0]
    con.execute('''INSERT INTO OrderLine(orderId,productId,qty,unit,unitPrice,priceApprovalStatus,stockUnit,stockUnitsPerSale)
                   VALUES(?,?,?,?,?,?,?,?)''',(oid,pid,3,unit,100,'not_required',stock_unit,1))
    lid=con.execute('SELECT id FROM OrderLine WHERE orderId=?',(oid,)).fetchone()[0]
    con.execute('''INSERT INTO SalesStockReservation(orderLineId,stockLotId,qty,createdBy,createdAt)
                   VALUES(?,?,2,'audit','2026-11-01 10:00:00')''',(lid,lot))
    rid=con.execute('SELECT id FROM SalesStockReservation ORDER BY id DESC LIMIT 1').fetchone()[0]
    return rid


def main():
    assert SOURCE.is_file()
    with tempfile.TemporaryDirectory(prefix='gocmd-cascade2-engaged-') as tmp:
        for scenario in range(8):
            db=Path(tmp)/f'case{scenario}.db'
            with sqlite3.connect(SOURCE) as src,sqlite3.connect(db) as dest:src.backup(dest)
            with sqlite3.connect(db) as con:
                # Recreate one of four legacy states: no guards / one missing
                # guard / lost index / all protections missing.
                if scenario%4 in (0,3):
                    for name in TRIGGERS:con.execute(f'DROP TRIGGER IF EXISTS "{name}"')
                elif scenario%4==1:con.execute(f'DROP TRIGGER IF EXISTS "{TRIGGERS[0]}"')
                elif scenario%4==2:con.execute(f'DROP TRIGGER IF EXISTS "{TRIGGERS[1]}"')
                if scenario%2==0:con.execute('DROP INDEX IF EXISTS "SalesStockReservation_engagedAt_idx"')
                con.commit()
            command=[sys.executable,str(MIGRATOR),'--db',str(db),'--apply']
            r=subprocess.run(command,text=True,capture_output=True,timeout=15)
            check(r.returncode==0, f'case {scenario}: migrator failed {r.stderr}')
            r=subprocess.run([sys.executable,str(MIGRATOR),'--db',str(db)],text=True,capture_output=True,timeout=15)
            check(r.returncode==0 and 'installée' in r.stdout,f'case {scenario}: non-idempotent {r.stderr} {r.stdout}')
            with sqlite3.connect(db) as con:
                for name in TRIGGERS:
                    check(con.execute('SELECT 1 FROM sqlite_master WHERE type=\'trigger\' AND name=?',(name,)).fetchone() is not None,f'{scenario}: missing trigger {name}')
                check(con.execute('SELECT 1 FROM sqlite_master WHERE type=\'index\' AND name=\'SalesStockReservation_engagedAt_idx\'').fetchone() is not None,'missing index')
                rid=fixture(con)
                row=con.execute('SELECT engagedAt,createdAt FROM SalesStockReservation WHERE id=?',(rid,)).fetchone()
                check(row[0] is not None and row[0]==row[1],f'{scenario}: inserted missing engagedAt: {row}')
                try:
                    con.execute("UPDATE SalesStockReservation SET engagedAt='2026-11-11' WHERE id=?",(rid,))
                except sqlite3.IntegrityError as exc:
                    check('GOCMD_ENGAGEMENT_DATE_IMMUTABLE' in str(exc),'unexpected immutable error')
                else:
                    raise AssertionError(f'{scenario}: engagedAt mutable')
                con.execute('UPDATE SalesStockReservation SET qty=qty-1 WHERE id=?',(rid,))
                check(con.execute('SELECT qty FROM SalesStockReservation WHERE id=?',(rid,)).fetchone()[0]==1,'normal qty update blocked')
                check(con.execute('PRAGMA integrity_check').fetchone()[0]=='ok','DB integrity failed')
                check(len(con.execute('PRAGMA foreign_key_check').fetchall())==0,'FK failed')
                con.rollback()
    print(f'PASS cascade2 engagement: 8 migration states, {CHECKS} functional assertions, no production data modified')
if __name__=='__main__':main()
