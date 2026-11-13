#!/usr/bin/env python3
"""VEN-03 : retours clients physiques sur BL, ajout SQLite non destructif."""
import argparse, sqlite3
from pathlib import Path
from datetime import datetime,timezone
SQL='''
CREATE TABLE IF NOT EXISTS "CustomerReturn"(
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "ref" TEXT NOT NULL UNIQUE,
 "deliveryLineId" INTEGER NOT NULL,
 "qty" REAL NOT NULL CHECK("qty">0),
 "unit" TEXT NOT NULL,
 "pieceIdsJson" TEXT NOT NULL DEFAULT '[]',
 "reason" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'requested' CHECK("status" IN ('requested','quarantine','accepted','rejected')),
 "requestKey" TEXT UNIQUE,
 "createdBy" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "receivedBy" TEXT,
 "receivedAt" DATETIME,
 "qualityBy" TEXT,
 "qualityAt" DATETIME,
 "qualityReason" TEXT,
 "finishedStockLotId" INTEGER UNIQUE,
 FOREIGN KEY("finishedStockLotId") REFERENCES "FinishedStockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("deliveryLineId") REFERENCES "SalesDeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CustomerReturn_deliveryLineId_status_idx" ON "CustomerReturn"("deliveryLineId","status");
'''

def run(path:Path,apply=False):
 if not path.exists():raise ValueError('Base absente')
 with sqlite3.connect(f'file:{path}?mode=ro',uri=True) as c:
  assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
  assert not c.execute('PRAGMA foreign_key_check').fetchall()
  for required in ("SalesDeliveryLine","FinishedStockLot"):
   if not c.execute('SELECT 1 FROM sqlite_master WHERE type="table" AND name=?',(required,)).fetchone():raise ValueError('Table manquante: '+required)
  exists=c.execute('SELECT 1 FROM sqlite_master WHERE type="table" AND name="CustomerReturn"').fetchone() is not None
 print('Table CustomerReturn:', 'existante' if exists else 'absente', ';', 'APPLY' if apply else 'DRY-RUN')
 if exists or not apply:return not exists
 backup=path.with_name(path.stem+'.avant_retours_clients_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.db')
 with sqlite3.connect(f'file:{path}?mode=ro',uri=True) as src, sqlite3.connect(backup) as dest:src.backup(dest)
 with sqlite3.connect(path) as c:
  c.execute('PRAGMA foreign_keys=ON')
  c.executescript(SQL)
  assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
  assert not c.execute('PRAGMA foreign_key_check').fetchall()
 print('Migration validée. Backup:', backup)
 return True
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--db',required=True,type=Path);a.add_argument('--apply',action='store_true');args=a.parse_args();run(args.db,args.apply)
