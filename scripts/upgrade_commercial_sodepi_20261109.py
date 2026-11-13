#!/usr/bin/env python3
"""Migration additive GoCmd commercial SODEPI. Exécuter sur une copie SQLite, jamais en prod sans recette.
Usage: python scripts/upgrade_commercial_sodepi_20261109.py --db db/custom.db --apply --ack DEMO_COPY_ONLY
"""
import sqlite3, argparse, pathlib, shutil, datetime, sys
PARSER=argparse.ArgumentParser()
PARSER.add_argument('--db',required=True)
PARSER.add_argument('--apply',action='store_true')
PARSER.add_argument('--ack',default='')
a=PARSER.parse_args()
path=pathlib.Path(a.db).resolve()
if not path.exists(): sys.exit('Base introuvable')
if not a.apply or a.ack!='DEMO_COPY_ONLY':sys.exit('Migration refusée : exécuter uniquement sur copie démo avec --apply --ack DEMO_COPY_ONLY')
with sqlite3.connect(str(path)) as con:
    if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok':sys.exit('Base invalide')
    if con.execute('PRAGMA foreign_key_check').fetchall():sys.exit('Violations FK avant migration')
backup=path.with_suffix('.backup_pre_commercial_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S')+'.db')
source=sqlite3.connect(str(path)); target=sqlite3.connect(str(backup));source.backup(target);target.close();source.close()
changes={
'OrderLine':{
 'catalogUnitPriceSnapshot':'REAL','priceApprovalStatus':"TEXT NOT NULL DEFAULT 'not_required'",
 'priceApprovedBy':'TEXT','priceApprovedAt':'DATETIME','priceApprovalReason':'TEXT',
 'technicalInstructions':'TEXT','customDimensionsJson':'TEXT','technicalReviewRequired':'INTEGER NOT NULL DEFAULT 0'},
'SalesQuote':{'priceReviewRequired':'INTEGER NOT NULL DEFAULT 0','priceApprovedBy':'TEXT','priceApprovedAt':'DATETIME','priceApprovalReason':'TEXT'}}
con=sqlite3.connect(str(path))
try:
 con.execute('BEGIN IMMEDIATE')
 for table,cols in changes.items():
  existing={row[1] for row in con.execute(f'PRAGMA table_info("{table}")')}
  for column,sql in cols.items():
   if column not in existing:con.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {sql}')
 con.commit()
 if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or con.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Échec intégrité')
 print('Migration commerciale additive OK — copie de sauvegarde:',backup)
except Exception:
 con.rollback();raise
finally:con.close()
