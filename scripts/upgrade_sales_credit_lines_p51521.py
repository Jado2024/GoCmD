#!/usr/bin/env python3
"""Migration NON destructive des avoirs détaillés SODEPI P5.15.21.
Usage: python scripts/upgrade_sales_credit_lines_p51521.py --db db/custom.db --apply
Sans --apply, prévisualisation seulement. Sauvegarde SQLite atomique avant modification.
"""
import argparse
import sqlite3
from pathlib import Path
from datetime import datetime, timezone

SQL='''CREATE TABLE IF NOT EXISTS "SalesCreditNoteLine" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "creditNoteId" INTEGER NOT NULL,
 "invoiceLineId" INTEGER NOT NULL,
 "qty" REAL NOT NULL CHECK ("qty">0),
 "amountCents" INTEGER NOT NULL CHECK ("amountCents">=0),
 "taxCents" INTEGER NOT NULL CHECK ("taxCents">=0),
 CONSTRAINT "SalesCreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "SalesCreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SalesCreditNoteLine_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "SalesInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalesCreditNoteLine_creditNoteId_invoiceLineId_key" ON "SalesCreditNoteLine"("creditNoteId","invoiceLineId");
CREATE INDEX IF NOT EXISTS "SalesCreditNoteLine_invoiceLineId_idx" ON "SalesCreditNoteLine"("invoiceLineId");'''

def run(path:Path,apply:bool):
 if not path.is_file():raise SystemExit('BDD introuvable : '+str(path))
 with sqlite3.connect(f'file:{path}?mode=ro',uri=True) as check:
  result=check.execute('PRAGMA integrity_check').fetchone()[0]
  if result!='ok':raise SystemExit('BDD corrompue : '+result)
  for table in ('SalesCreditNote','SalesInvoiceLine','AuditEvent'):
   if not check.execute('SELECT 1 FROM sqlite_master WHERE type="table" AND name=?',(table,)).fetchone():raise SystemExit('Table source absente : '+table)
  exists=check.execute('SELECT 1 FROM sqlite_master WHERE type="table" AND name="SalesCreditNoteLine"').fetchone()
 print('Avant :', 'déjà migrée' if exists else 'nouvelle table à créer')
 if not apply:
  print('MODE LECTURE SEULE : utiliser --apply après sauvegarde/validation')
  return
 backup=path.with_name(path.stem+'.avant_avoirs_lignes_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.db')
 with sqlite3.connect(f'file:{path}?mode=ro',uri=True) as src,sqlite3.connect(backup) as dst:
  src.backup(dst)
 with sqlite3.connect(path) as conn:
  conn.execute('PRAGMA foreign_keys=ON')
  if conn.execute('PRAGMA foreign_key_check').fetchall():raise SystemExit('FK incorrectes avant migration')
  conn.executescript(SQL)
  if conn.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or conn.execute('PRAGMA foreign_key_check').fetchall():
   raise SystemExit('Validation post-migration échouée')
 print('OK. Sauvegarde pré-migration :',backup)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--db',type=Path,required=True);p.add_argument('--apply',action='store_true');a=p.parse_args();run(a.db,a.apply)
