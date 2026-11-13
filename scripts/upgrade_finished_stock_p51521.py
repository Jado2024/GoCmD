#!/usr/bin/env python3
"""VEN-01 — stock de produits finis SODEPI, migration additive. Mode lecture seule par défaut.

Ne modifie jamais la table StockLot (matières). Fait une copie SQLite cohérente
avant toute modification. Ne crée pas d'entrées de stock fictives.
"""
import argparse
import sqlite3
from pathlib import Path
from datetime import datetime,timezone

SQL = '''
CREATE TABLE IF NOT EXISTS "FinishedStockLot" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "productId" INTEGER NOT NULL,
  "lotCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'quarantine' CHECK ("status" IN ('quarantine','available','rejected','exhausted')),
  "qty" INTEGER NOT NULL DEFAULT 0 CHECK ("qty" >= 0),
  "sourceRef" TEXT NOT NULL,
  "receivedBy" TEXT NOT NULL,
  "qualityBy" TEXT,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME,
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinishedStockLot_productId_lotCode_key" ON "FinishedStockLot"("productId","lotCode");
CREATE INDEX IF NOT EXISTS "FinishedStockLot_productId_status_idx" ON "FinishedStockLot"("productId","status");
CREATE TABLE IF NOT EXISTS "FinishedStockMovement" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "ref" TEXT NOT NULL UNIQUE,
  "lotId" INTEGER NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('received_quarantine','available','rejected','out')),
  "qty" INTEGER NOT NULL,
  "document" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("lotId") REFERENCES "FinishedStockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "FinishedStockMovement_lotId_createdAt_idx" ON "FinishedStockMovement"("lotId","createdAt");
CREATE TABLE IF NOT EXISTS "FinishedStockAllocation" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "deliveryLineId" INTEGER NOT NULL,
  "lotId" INTEGER NOT NULL,
  "qty" INTEGER NOT NULL CHECK ("qty" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("deliveryLineId") REFERENCES "SalesDeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("lotId") REFERENCES "FinishedStockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinishedStockAllocation_deliveryLineId_lotId_key" ON "FinishedStockAllocation"("deliveryLineId","lotId");
CREATE INDEX IF NOT EXISTS "FinishedStockAllocation_lotId_idx" ON "FinishedStockAllocation"("lotId");
'''
REQUIRED=['Product','SalesDeliveryLine','SalesDocCounter','AuditEvent']
TABLES=['FinishedStockLot','FinishedStockMovement','FinishedStockAllocation']

def migrate(db:Path,apply:bool=False)->bool:
    if not db.is_file():raise ValueError(f'Base absente: {db}')
    with sqlite3.connect(f'file:{db}?mode=ro',uri=True) as con:
        assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert not con.execute('PRAGMA foreign_key_check').fetchall()
        names={x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not set(REQUIRED)<=names:raise ValueError('Tables sources manquantes: '+str(set(REQUIRED)-names))
        missing=set(TABLES)-names
    print(f'Migration finished-stock : {len(missing)} tables manquantes ; {"APPLICATION" if apply else "LECTURE SEULE"}')
    if not apply or not missing:return bool(missing)
    bak=db.with_name(db.stem+'.avant_stock_fini_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.db')
    with sqlite3.connect(f'file:{db}?mode=ro',uri=True) as src,sqlite3.connect(bak) as dst:src.backup(dst)
    with sqlite3.connect(db) as con:
        con.execute('PRAGMA foreign_keys=ON')
        con.executescript(SQL)
        assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert not con.execute('PRAGMA foreign_key_check').fetchall()
    print('Migration conforme, sauvegarde:',bak)
    return True

if __name__=='__main__':
    arg=argparse.ArgumentParser();arg.add_argument('--db',type=Path,required=True);arg.add_argument('--apply',action='store_true')
    args=arg.parse_args()
    migrate(args.db,args.apply)
