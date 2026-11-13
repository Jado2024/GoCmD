#!/usr/bin/env python3
"""P5.15.4 - migration non destructive. (P5.15.12 : comparaison péremption corrigée epoch-ms, AN-CPL-01 ;
P5.15.13 : garde durcie epoch-ms + texte avec discrimination typeof, fail-closed — cf. fix_reservation_trigger_p51512.py)
Dry-run par défaut, --apply avec --backup externe.
Pas d'accès à une base utilisateur sans --apply explicitement demandé par l'opérateur.
"""
import argparse, pathlib, sqlite3, sys

ADDITIONS={
 'Order':{'fulfillmentStatus':'TEXT NOT NULL DEFAULT \'open\'','fulfillmentReason':'TEXT','fulfillmentActor':'TEXT','fulfillmentChangedAt':'DATETIME'},
 'SalesDelivery':{'requestKey':'TEXT','requestHash':'TEXT'},
}
DDL=[
 '''CREATE UNIQUE INDEX IF NOT EXISTS "SalesDelivery_requestKey_key" ON "SalesDelivery"("requestKey")''',
 '''CREATE TABLE IF NOT EXISTS "SalesStockReservation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderLineId" INTEGER NOT NULL REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "stockLotId" INTEGER NOT NULL REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "qty" REAL NOT NULL CHECK("qty" > 0),
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("orderLineId","stockLotId")
   )''',
 'CREATE INDEX IF NOT EXISTS "SalesStockReservation_stockLotId_idx" ON "SalesStockReservation"("stockLotId")',
 'CREATE INDEX IF NOT EXISTS "SalesStockReservation_orderLineId_stockLotId_key" ON "SalesStockReservation"("orderLineId","stockLotId")',
 # La réservation ne peut dépasser le lot, y compris par SQL direct.
 """CREATE TRIGGER IF NOT EXISTS "gocmd_p5154_reservation_insert"
 AFTER INSERT ON "SalesStockReservation"
 BEGIN
   SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "StockLot" l
    JOIN "OrderLine" ol ON ol.id=NEW."orderLineId"
    JOIN "Product" p ON p.id=ol."productId"
    WHERE l.id=NEW."stockLotId" AND l."materialId"=p."materialId"
      AND l."status"='available' AND
      (l."expiresAt" IS NULL
       OR (typeof(l."expiresAt") IN ('integer','real')
           AND l."expiresAt" > CAST(strftime('%s','now') AS INTEGER)*1000)
       OR (typeof(l."expiresAt")='text'
           AND datetime(l."expiresAt") IS NOT NULL
           AND datetime(l."expiresAt") > datetime('now')))
      AND l."qty"+0.0000001 >=
       (SELECT COALESCE(SUM(r."qty"),0) FROM "SalesStockReservation" r WHERE r."stockLotId"=l.id)
   ) THEN RAISE(ABORT,'RESERVATION_EXCEEDS_LOT') END;
 END""",
 """CREATE TRIGGER IF NOT EXISTS "gocmd_p5154_reservation_update"
 AFTER UPDATE OF "qty","stockLotId","orderLineId" ON "SalesStockReservation"
 BEGIN
   SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "StockLot" l
    JOIN "OrderLine" ol ON ol.id=NEW."orderLineId"
    JOIN "Product" p ON p.id=ol."productId"
    WHERE l.id=NEW."stockLotId" AND l."materialId"=p."materialId"
      AND l."status"='available' AND
      (l."expiresAt" IS NULL
       OR (typeof(l."expiresAt") IN ('integer','real')
           AND l."expiresAt" > CAST(strftime('%s','now') AS INTEGER)*1000)
       OR (typeof(l."expiresAt")='text'
           AND datetime(l."expiresAt") IS NOT NULL
           AND datetime(l."expiresAt") > datetime('now')))
      AND l."qty"+0.0000001 >=
       (SELECT COALESCE(SUM(r."qty"),0) FROM "SalesStockReservation" r WHERE r."stockLotId"=l.id)
   ) THEN RAISE(ABORT,'RESERVATION_EXCEEDS_LOT') END;
 END""",
 """CREATE TRIGGER IF NOT EXISTS "gocmd_p5154_lot_reserved_guard"
 BEFORE UPDATE OF "qty","status" ON "StockLot"
 BEGIN
   SELECT CASE WHEN NEW."qty"+0.0000001 <
        (SELECT COALESCE(SUM(r."qty"),0) FROM "SalesStockReservation" r WHERE r."stockLotId"=OLD.id)
     OR (NEW."status"!='available' AND
        EXISTS(SELECT 1 FROM "SalesStockReservation" r WHERE r."stockLotId"=OLD.id))
    THEN RAISE(ABORT,'STOCK_RESERVED') END;
 END""",

]

def migrate(db, apply=False, backup=None):
 target=pathlib.Path(db).expanduser().resolve()
 if not target.is_file():raise ValueError('Base SQLite absente : aucun fichier créé')
 if apply:
  if not backup:raise ValueError('--backup externe obligatoire avec --apply')
  backup=pathlib.Path(backup).expanduser().resolve()
  if backup.exists() or backup==target or backup.parent==target.parent:
   raise ValueError('Le fichier de sauvegarde doit être nouveau et hors du dossier de base')
 con=sqlite3.connect(str(target) if apply else target.as_uri()+'?mode=ro',uri=not apply)
 try:
  con.execute('PRAGMA foreign_keys=ON')
  assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok', 'Base non intègre'
  assert not con.execute('PRAGMA foreign_key_check').fetchall(), 'FK non intègres'
  existing={row[0] for row in con.execute('SELECT name FROM sqlite_master WHERE type="table"')}
  needed=set(ADDITIONS)|{'OrderLine','StockLot','SalesDeliveryLine','SalesStockAllocation'}
  if not needed<=existing:raise ValueError(f'Tables manquantes: {sorted(needed-existing)} ; migrer P5.15.3 en premier')
  missing={table:{name:ddl for name,ddl in cols.items() if name not in {row[1] for row in con.execute(f'PRAGMA table_info("{table}")')}} for table,cols in ADDITIONS.items()}
  if not apply:
   print('DRY-RUN P5.15.4',missing,'reservations:', 'présentes' if 'SalesStockReservation' in existing else 'à créer')
   return
  backup.parent.mkdir(parents=True,exist_ok=True)
  with sqlite3.connect(backup) as out:con.backup(out)
  con.execute('BEGIN IMMEDIATE')
  try:
   for table,cols in missing.items():
    for name,ddl in cols.items():con.execute(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {ddl}')
   for ddl in DDL:con.execute(ddl)
   con.commit()
  except Exception:
   con.rollback()
   raise
  assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok', 'Erreur intégrité après migration ; restaurer la sauvegarde'
  assert not con.execute('PRAGMA foreign_key_check').fetchall(), 'Erreur FK après migration'
  print('PASS P5.15.4 : migration additive, sauvegarde:',backup)
 finally:con.close()

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--db',required=True);p.add_argument('--apply',action='store_true');p.add_argument('--backup')
 a=p.parse_args()
 try:migrate(a.db,a.apply,a.backup);return 0
 except Exception as e:print('ERROR:',e,file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
