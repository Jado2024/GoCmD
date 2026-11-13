#!/usr/bin/env python3
"""P5.15.29-P5 — index unique par client pour numéros externes normalisés.
Migration hors ligne, additive et transactionnelle. Aucune commande historique supprimée.
Si des numéros historiquement en doublon existent, bloquer et faire arbitrer.
"""
import argparse
import datetime
import sqlite3
import unicodedata
from pathlib import Path

FIELD = 'customerOrderNoNormalized'
UNIQUE = 'Order_clientId_customerOrderNoNormalized_key'
DAY_INDEX = 'Order_clientId_dueDate_idx'

def normalize(text):
    return ' '.join(unicodedata.normalize('NFKC', text or '').split()).upper() or None

def upgrade(path:Path, apply=False):
    if not path.is_file(): raise ValueError('Base absente')
    with sqlite3.connect(f'file:{path}?mode=ro',uri=True,timeout=20) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Intégrité invalide')
        if db.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Clés étrangères invalides')
        if db.execute('PRAGMA journal_mode').fetchone()[0].lower()!='delete':raise ValueError('Journal DELETE obligatoire; arrêter GoCmd')
        cols={x[1] for x in db.execute('PRAGMA table_info("Order")')}
        if not {'clientId','customerOrderNo','dueDate'}.issubset(cols):raise ValueError('Schéma Order incomplet')
        rows=db.execute('SELECT id,"clientId","customerOrderNo" FROM "Order"').fetchall()
        seen={}
        for order_id,client_id,reference in rows:
            normalized=normalize(reference)
            if not normalized:continue
            unique_key=(client_id,normalized)
            if unique_key in seen:raise ValueError(f'Doublon de numéro client historique : commandes {seen[unique_key]} et {order_id}; arbitrage manuel requis')
            seen[unique_key]=order_id
        missing=FIELD not in cols
        indexes={x[1] for x in db.execute('PRAGMA index_list("Order")')}
        pending=missing or UNIQUE not in indexes or DAY_INDEX not in indexes
    result={'missing_column':missing,'missing_indexes':[n for n in (UNIQUE,DAY_INDEX) if n not in indexes], 'historical_references':len(seen),'applied':False}
    if not apply or not pending:return result
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup=path.with_name(path.name+'.before-p51529p5-'+stamp+'.db')
    with sqlite3.connect(f'file:{path}?mode=ro',uri=True,timeout=30) as src,sqlite3.connect(backup) as dst:src.backup(dst)
    with sqlite3.connect(path,timeout=30) as db:
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE')
        try:
            if missing:db.execute(f'ALTER TABLE "Order" ADD COLUMN "{FIELD}" TEXT')
            for order_id, _, ref in rows:db.execute(f'UPDATE "Order" SET "{FIELD}"=? WHERE id=?',(normalize(ref),order_id))
            db.execute(f'CREATE UNIQUE INDEX IF NOT EXISTS "{UNIQUE}" ON "Order"("clientId", "{FIELD}")')
            db.execute(f'CREATE INDEX IF NOT EXISTS "{DAY_INDEX}" ON "Order"("clientId", "dueDate")')
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Contrôle de migration échoué')
            db.commit()
        except Exception:
            db.rollback();raise
    result.update(applied=True,backup=str(backup))
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',required=True,type=Path);p.add_argument('--apply',action='store_true');a=p.parse_args()
    print(upgrade(a.db,a.apply))
