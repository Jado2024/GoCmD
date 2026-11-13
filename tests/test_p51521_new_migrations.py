#!/usr/bin/env python3
"""Tests autonomes pour le programme de migration et l'expiration : BDD jetables."""
import importlib.util
import os
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime,timedelta,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def check():
 with tempfile.TemporaryDirectory() as t:
  db=Path(t)/'test.db'
  with sqlite3.connect(db) as c:
   c.executescript('''PRAGMA foreign_keys=ON;
   CREATE TABLE SalesCreditNote (id INTEGER PRIMARY KEY);
   CREATE TABLE SalesInvoiceLine (id INTEGER PRIMARY KEY);
   CREATE TABLE AuditEvent (id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,entityId TEXT NOT NULL,details TEXT,createdAt DATETIME NOT NULL);
   CREATE TABLE SalesStockReservation (id INTEGER PRIMARY KEY,orderLineId INTEGER,stockLotId INTEGER,qty REAL,createdBy TEXT,createdAt DATETIME,updatedAt DATETIME);
   INSERT INTO SalesCreditNote VALUES (11);INSERT INTO SalesInvoiceLine VALUES (22);
   ''')
  cmd=[sys.executable,str(ROOT/'scripts/upgrade_sales_credit_lines_p51521.py'),'--db',str(db),'--apply']
  for _ in range(2):
   p=subprocess.run(cmd,capture_output=True,text=True)
   assert p.returncode==0,(p.stdout,p.stderr)
  with sqlite3.connect(db) as c:
   c.execute('PRAGMA foreign_keys=ON')
   c.execute('INSERT INTO SalesCreditNoteLine (creditNoteId,invoiceLineId,qty,amountCents,taxCents) VALUES (11,22,1,1000,200)')
   assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
   try:c.execute('INSERT INTO SalesCreditNoteLine (creditNoteId,invoiceLineId,qty,amountCents,taxCents) VALUES (11,22,1,1000,200)')
   except sqlite3.IntegrityError:pass
   else:raise AssertionError('Double ligne acceptée')
   assert c.execute('SELECT COUNT(*) FROM SalesCreditNoteLine').fetchone()[0]==1
  spec=importlib.util.spec_from_file_location('expiry',ROOT/'scripts/expire_sales_reservations_p51521.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  os.environ['GOCMD_RESERVATION_TTL_HOURS']='72';os.environ['GOCMD_RESERVATION_WARNING_HOURS']='12'
  now=datetime.now(timezone.utc)
  with sqlite3.connect(db) as c:
   c.execute('INSERT INTO SalesStockReservation VALUES (1,100,200,1.5,\'acheteur\',?,?)',((now-timedelta(hours=80)).isoformat(),(now-timedelta(hours=80)).isoformat()))
   c.execute('INSERT INTO SalesStockReservation VALUES (2,101,201,1,\'acheteur\',?,?)',((now-timedelta(hours=65)).isoformat(),(now-timedelta(hours=65)).isoformat()))
  preview=mod.run(db,False,now)
  assert preview['expired']==1 and preview['expiringSoon']==1
  with sqlite3.connect(db) as c:assert c.execute('SELECT COUNT(*) FROM SalesStockReservation').fetchone()[0]==2
  done=mod.run(db,True,now)
  assert done['expired']==1
  with sqlite3.connect(db) as c:
   assert c.execute('SELECT id FROM SalesStockReservation').fetchall()==[(2,)]
   assert c.execute('SELECT action FROM AuditEvent').fetchone()[0]=='SALES_STOCK_RESERVATION_EXPIRED'
 print('PASS: migration idempotente, unique/FK, expiration préavis, audit et lecture seule')

if __name__=='__main__':check()
