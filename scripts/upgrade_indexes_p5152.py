#!/usr/bin/env python3
"""Migration conservative des index de pagination P5.15.2.
Par défaut en lecture seule. --apply nécessite --backup dans un autre dossier.
Ne remplace jamais une base utilisateur et ne réinitialise aucune donnée.
"""
import argparse,sqlite3,os,pathlib,sys
INDICES={
 'PurchaseRequest_status_createdAt_id_idx':('PurchaseRequest','status, createdAt, id'),
 'PurchaseRequest_createdAt_id_idx':('PurchaseRequest','createdAt, id'),
 'SupplierRFQ_createdAt_id_idx':('SupplierRFQ','createdAt, id'),
 'SupplierConsultation_createdAt_id_idx':('SupplierConsultation','createdAt, id'),
 'StockCount_countedAt_id_idx':('StockCount','countedAt, id')
}
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument('--db',required=True);ap.add_argument('--apply',action='store_true')
 ap.add_argument('--backup',help='chemin externe de sauvegarde, obligatoire si --apply')
 a=ap.parse_args()
 target=pathlib.Path(a.db).resolve()
 if not target.is_file():ap.error('Base absente')
 if a.apply and not a.backup:ap.error('Sauvegarde obligatoire avant application (--backup)')
 backup=pathlib.Path(a.backup).resolve() if a.backup else None
 if a.apply and (backup==target or backup.exists() or backup.parent==target.parent):ap.error('Sauvegarde existante ou dans le dossier de base ; choisir une destination séparée nouvelle')
 if not a.apply:
  with sqlite3.connect(target.as_uri()+'?mode=ro',uri=True) as db:
   missing=[k for k in INDICES if not db.execute('SELECT 1 FROM sqlite_master WHERE type="index" AND name=?',(k,)).fetchone()]
  print('DRY-RUN: index manquants:',missing)
  return 0
 assert backup
 backup.parent.mkdir(parents=True,exist_ok=True)
 with sqlite3.connect(target) as db:
  with sqlite3.connect(backup) as b:db.backup(b)
  if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Base initiale non intègre; abandon')
  try:
   db.execute('BEGIN IMMEDIATE')
   for name,(table,columns) in INDICES.items():
    db.execute(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({columns})')
   db.commit()
  except Exception:
   db.rollback();raise
  if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Intégrité de la base migrée défaillante ; restaurer sauvegarde')
 print('PASS P5.15.2: index SQL appliqués (idempotent); sauvegarde:',backup)
 return 0
if __name__=='__main__':sys.exit(main())
