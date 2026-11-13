#!/usr/bin/env python3
"""P5.15.3: extension additive du catalogue pour revente de matières.

DRY-RUN par défaut. --apply exige --backup ABSENT dans un autre dossier.
Ne réinitialise aucune fiche, commande, lot ou mouvement existant.
"""
import argparse
import pathlib
import sqlite3
import sys

COLUMNS = {
 "Material": {
  "isPurchasable": "BOOLEAN NOT NULL DEFAULT 1", "isManufactured": "BOOLEAN NOT NULL DEFAULT 0",
  "isSellable": "BOOLEAN NOT NULL DEFAULT 0", "isInternalUse": "BOOLEAN NOT NULL DEFAULT 1",
  "salesUnit": "TEXT", "unitsPerSale": "REAL NOT NULL DEFAULT 1", "salesUnitPrice": "REAL NOT NULL DEFAULT 0",
 },
 "Product": {"materialId": "INTEGER REFERENCES Material(id)", "unitsPerSale": "REAL NOT NULL DEFAULT 1"},
 "OrderLine": {"stockUnit": "TEXT", "stockUnitsPerSale": "REAL NOT NULL DEFAULT 1"},
}
DDL = '''
CREATE UNIQUE INDEX IF NOT EXISTS "Product_materialId_key" ON "Product"("materialId");
CREATE TABLE IF NOT EXISTS "SalesStockAllocation" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "deliveryLineId" INTEGER NOT NULL REFERENCES "SalesDeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "stockLotId" INTEGER NOT NULL REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "movementId" INTEGER NOT NULL UNIQUE REFERENCES "Movement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "qty" REAL NOT NULL,
 "unit" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS "SalesStockAllocation_deliveryLineId_idx" ON "SalesStockAllocation"("deliveryLineId");
CREATE INDEX IF NOT EXISTS "SalesStockAllocation_stockLotId_idx" ON "SalesStockAllocation"("stockLotId");
'''

def run(database, apply, backup):
 target=pathlib.Path(database).resolve()
 if not target.is_file(): raise ValueError('Base SQLite inexistante, aucun fichier créé')
 if apply:
  if not backup: raise ValueError('Sauvegarde externe obligatoire pour --apply')
  b=pathlib.Path(backup).resolve()
  if b==target or b.exists() or b.parent==target.parent: raise ValueError('Sauvegarde cible déjà présente ou dans le répertoire actif')
 else: b=None
 connection=sqlite3.connect(str(target) if apply else target.as_uri()+'?mode=ro',uri=not apply)
 try:
  connection.execute('PRAGMA foreign_keys=ON')
  if connection.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or connection.execute('PRAGMA foreign_key_check').fetchall():
   raise ValueError('Base non intègre : abandon')
  existing={r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  if not {'Material','Product','OrderLine','SalesDeliveryLine','StockLot','Movement'}<=existing:
   raise ValueError('Schéma GoCmd incomplet : abandon')
  pending={table:{name:definition for name,definition in fields.items() if name not in {x[1] for x in connection.execute(f'PRAGMA table_info("{table}")')}} for table,fields in COLUMNS.items()}
  if not apply:
   print('DRY-RUN P5.15.3:',pending,'SalesStockAllocation:', 'absente' if 'SalesStockAllocation' not in existing else 'présente')
   return
  b.parent.mkdir(parents=True,exist_ok=True)
  with sqlite3.connect(b) as copy: connection.backup(copy)
  connection.execute('BEGIN IMMEDIATE')
  try:
   for table,fields in pending.items():
    for name,definition in fields.items(): connection.execute(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {definition}')
   # Seules les matières AGGLO héritées deviennent explicitement non achetables.
   # Aucun mouvement ni solde initial n'est recalculé.
   connection.execute("UPDATE Material SET isPurchasable=0,isManufactured=1 WHERE category='Mousse' AND foamNature='AGGLO' AND isPurchasable=1")
   # Conserver TOUS les contrôles historiques du catalogue. L'unique ajout
   # aux triggers existants est la famille de négoce et son lien matière obligatoire.
   for trigger in ('go_v16_product_insert','go_v16_product_update'):
    entry=connection.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?",(trigger,)).fetchone()
    if not entry:raise ValueError(f'Trigger historique manquant : {trigger}')
    sql=entry[0]
    needle="'MATELAS','BANQUETTE','SALON','GAUFRETTE','PLAQUE_MOUSSE','OUATE')"
    if needle not in sql:
     if "'OUATE','NEGOCE')" in sql:continue # déjà migré (idempotence)
     raise ValueError(f'Contrat de famille inconnu pour {trigger}')
    sql=sql.replace(needle,"'MATELAS','BANQUETTE','SALON','GAUFRETTE','PLAQUE_MOUSSE','OUATE','NEGOCE')",1)
    sql=sql.replace("THEN RAISE(ABORT,'Famille inconnue') END;", "THEN RAISE(ABORT,'Famille inconnue') END;\n          SELECT CASE WHEN (NEW.family='NEGOCE' AND (NEW.materialId IS NULL OR NEW.unitsPerSale<=0)) OR (NEW.family!='NEGOCE' AND NEW.materialId IS NOT NULL)\n            THEN RAISE(ABORT,'Négoce : matière source et conversion requises') END;",1)
    connection.execute(f'DROP TRIGGER IF EXISTS "{trigger}"')
    connection.execute(sql)
   # executescript déclenche commit implicite : exécuter instruction par instruction.
   for statement in DDL.split(';'):
    if statement.strip(): connection.execute(statement)
   connection.commit()
  except Exception:
   connection.rollback()
   raise
  if connection.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or connection.execute('PRAGMA foreign_key_check').fetchall():
   raise ValueError('Contrôle d’intégrité post-migration échoué : restaurer la sauvegarde')
  print('PASS P5.15.3 : migration additive / intégrité OK ; sauvegarde',b)
 finally:connection.close()

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--db',required=True);p.add_argument('--apply',action='store_true');p.add_argument('--backup')
 a=p.parse_args()
 try:run(a.db,a.apply,a.backup)
 except Exception as err:print(f'ERROR: {err}',file=sys.stderr);return 1
 return 0
if __name__=='__main__':sys.exit(main())
