#!/usr/bin/env python3
"""Migration additive des réservations de matelas finis — sauvegarde avant écriture.
La migration ne crée aucune réservation fictive pour les OF historiques.
"""
import argparse
from pathlib import Path
import sqlite3
import sys
from datetime import datetime, timezone

SQL = '''
CREATE TABLE IF NOT EXISTS "FinishedStockReservation" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "orderLineId" INTEGER NOT NULL REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "lotId" INTEGER NOT NULL REFERENCES "FinishedStockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "qty" INTEGER NOT NULL CHECK("qty">0),
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinishedStockReservation_orderLineId_lotId_key" ON "FinishedStockReservation"("orderLineId","lotId");
CREATE INDEX IF NOT EXISTS "FinishedStockReservation_lotId_idx" ON "FinishedStockReservation"("lotId");
CREATE TRIGGER IF NOT EXISTS "FinishedStockReservation_capacity_insert" BEFORE INSERT ON "FinishedStockReservation"
WHEN (SELECT "status" FROM "FinishedStockLot" WHERE "id"=NEW."lotId")<>'available'
 OR (SELECT "qty" FROM "FinishedStockLot" WHERE "id"=NEW."lotId") <
  NEW."qty" + COALESCE((SELECT SUM("qty") FROM "FinishedStockReservation" WHERE "lotId"=NEW."lotId"),0)
BEGIN SELECT RAISE(ABORT,'FINISHED_STOCK_RESERVED'); END;
CREATE TRIGGER IF NOT EXISTS "FinishedStockReservation_capacity_update" BEFORE UPDATE OF "qty","lotId" ON "FinishedStockReservation"
WHEN (SELECT "status" FROM "FinishedStockLot" WHERE "id"=NEW."lotId")<>'available'
 OR (SELECT "qty" FROM "FinishedStockLot" WHERE "id"=NEW."lotId") <
  NEW."qty" + COALESCE((SELECT SUM("qty") FROM "FinishedStockReservation" WHERE "lotId"=NEW."lotId" AND "id"<>OLD."id"),0)
BEGIN SELECT RAISE(ABORT,'FINISHED_STOCK_RESERVED'); END;
CREATE TRIGGER IF NOT EXISTS "FinishedStockLot_guard_reserved_qty" BEFORE UPDATE OF "qty","status" ON "FinishedStockLot"
WHEN NEW."qty" < COALESCE((SELECT SUM("qty") FROM "FinishedStockReservation" WHERE "lotId"=OLD."id"),0)
 OR (NEW."status"<>'available' AND EXISTS(SELECT 1 FROM "FinishedStockReservation" WHERE "lotId"=OLD."id"))
BEGIN SELECT RAISE(ABORT,'FINISHED_STOCK_RESERVED'); END;
CREATE TRIGGER IF NOT EXISTS "FinishedStockReservation_guard_insert" BEFORE INSERT ON "FinishedStockReservation"
WHEN (SELECT ol."productId" FROM "OrderLine" ol WHERE ol."id"=NEW."orderLineId")
  <> (SELECT fl."productId" FROM "FinishedStockLot" fl WHERE fl."id"=NEW."lotId")
BEGIN SELECT RAISE(ABORT,'FINISHED_RESERVATION_PRODUCT_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS "FinishedStockReservation_guard_update" BEFORE UPDATE OF "orderLineId","lotId" ON "FinishedStockReservation"
WHEN (SELECT ol."productId" FROM "OrderLine" ol WHERE ol."id"=NEW."orderLineId")
  <> (SELECT fl."productId" FROM "FinishedStockLot" fl WHERE fl."id"=NEW."lotId")
BEGIN SELECT RAISE(ABORT,'FINISHED_RESERVATION_PRODUCT_MISMATCH'); END;
'''

def migrate(db, apply=False):
    path=Path(db).resolve()
    if not path.is_file(): raise ValueError('Base absente')
    with sqlite3.connect(path) as con:
        con.execute('PRAGMA foreign_keys=ON')
        if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or con.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Intégrité de la base invalide')
        tables={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required={'WorkOrder','FinishedStockLot','OrderLine','Order','Product'}
        if not required<=tables: raise ValueError('Migration préalable manquante: '+str(required-tables))
        columns={r[1] for r in con.execute('PRAGMA table_info("WorkOrder")')}
        needed='FinishedStockReservation' not in tables or 'preparationKind' not in columns
        print('Réservations de matelas :', 'requises' if needed else 'installées', '(application)' if apply else '(contrôle seul)')
        if not apply or not needed: return needed
        backup=path.with_name(path.stem+'.avant_reservation_fini_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.db')
        with sqlite3.connect(backup) as dst: con.backup(dst)
        upgrade=''
        if 'preparationKind' not in columns:
            upgrade='ALTER TABLE "WorkOrder" ADD COLUMN "preparationKind" TEXT;\n'
            upgrade+='''UPDATE "WorkOrder" SET "preparationKind"='legacy_stock'
              WHERE "status"='completed' AND "startedAt" IS NULL
              AND EXISTS(SELECT 1 FROM "OrderLine" l JOIN "Product" p ON p."id"=l."productId"
                WHERE l."id"="WorkOrder"."orderLineId" AND p."family"='MATELAS');\n'''
        try:
            con.executescript('BEGIN IMMEDIATE;\n'+upgrade+SQL+'\nCOMMIT;')
        except Exception:
            con.rollback()
            raise
        if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or con.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Intégrité après migration invalide (restaurer sauvegarde)')
        print('PASS sauvegarde', backup)
        return True

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--db',required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    try: migrate(args.db,args.apply)
    except Exception as e:
        print('ERREUR migration:',str(e),file=sys.stderr)
        sys.exit(1)
