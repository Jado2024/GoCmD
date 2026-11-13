#!/usr/bin/env python3
"""Migration additive GoCmd V18.9.5 ; backup atomique SQLite AVANT changement.
Usage: python scripts/apply_director_price_upgrade_v1895.py --db /abs/base.db --apply
Ne jamais migrer une base active : arrêter GoCmd puis sauvegarder hors serveur.
"""
import argparse, sqlite3, pathlib, datetime, hashlib, sys

COLS={
 'specialPriceStatus':"TEXT NOT NULL DEFAULT 'not_required'",
 'specialApprovedUnitPrice':'REAL',
 'specialPriceProposedBy':'TEXT',
 'specialPriceApprovedBy':'TEXT',
 'specialPriceApprovedAt':'DATETIME',
 'specialPriceDecisionReason':'TEXT',
 'specialPriceRevision':'INTEGER NOT NULL DEFAULT 0',
}

def upgrade(file:pathlib.Path,apply:bool)->tuple[int,int]:
 if not file.is_file():raise ValueError(f'Base absente : {file}')
 db=sqlite3.connect(f'file:{file}?mode=rw',uri=True)
 try:
  if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Base incohérente : migration refusée')
  cols={row[1] for row in db.execute('PRAGMA table_info(Product)')}
  if not cols:raise ValueError('Table Product absente')
  missing=[name for name in COLS if name not in cols]
  if not apply:
   print('SIMULATION. Colonnes à ajouter :',missing);return len(missing),0
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
  backup=file.with_name(file.name+f'.pre-v1895-{stamp}.sqlite')
  if missing:
   if backup.exists():raise ValueError('Sauvegarde de même nom existante : réessayer plus tard')
   with sqlite3.connect(backup) as dest:db.backup(dest)
   with sqlite3.connect(backup) as check:
    if check.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Sauvegarde incohérente')
   print('Backup transactionnel vérifié :',backup, 'SHA-256:',hashlib.sha256(backup.read_bytes()).hexdigest())
   db.execute('BEGIN IMMEDIATE')
   try:
    for name in missing:db.execute(f'ALTER TABLE Product ADD COLUMN "{name}" {COLS[name]}')
    # Ne jamais inventer une approbation de directeur sur les données antérieures.
    # Les produits spéciaux non approuvés restent non vendables à prix libre.
    db.execute("UPDATE Product SET specialPriceStatus='pending',specialPriceRevision=1 WHERE specialNotes IS NOT NULL AND length(trim(specialNotes))>0 AND specialPriceStatus='not_required'")
    db.commit()
   except:db.rollback();raise
  if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Intégrité post-migration en échec')
  if db.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Clés étrangères incohérentes')
  count=db.execute("SELECT count(*) FROM Product WHERE specialPriceStatus='pending'").fetchone()[0]
  print(f'PASS : {len(missing)} colonnes ajoutées ; {count} références spéciales en attente ; intégrité OK')
  return len(missing),count
 finally:db.close()

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--db',required=True,type=pathlib.Path);parser.add_argument('--apply',action='store_true')
 args=parser.parse_args()
 try:upgrade(args.db.resolve(),args.apply)
 except Exception as e:print('ÉCHEC :',e,file=sys.stderr);sys.exit(2)
