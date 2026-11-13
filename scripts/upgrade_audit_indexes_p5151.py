#!/usr/bin/env python3
"""P5.15.1 : index additif/idempotent pour le journal des décisions DA."""
import argparse
import sqlite3
from contextlib import closing
from pathlib import Path

def upgrade(path):
    with closing(sqlite3.connect(str(path), timeout=30)) as con:
        if not con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='AuditEvent'").fetchone():
            raise RuntimeError('Table AuditEvent absente : appliquer les migrations historiques')
        con.execute('CREATE INDEX IF NOT EXISTS "AuditEvent_entity_entityId_id_idx" ON "AuditEvent" ("entity","entityId","id")')
        con.commit()
        if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Intégrité SQLite invalide')
        if con.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('Clés étrangères invalides')
    print('PASS P5.15.1 : index ciblé des journaux, aucune donnée effacée')

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--db',required=True)
    p.add_argument('--apply',action='store_true')
    a=p.parse_args()
    db=Path(a.db).resolve()
    if not db.is_file():raise SystemExit('Base introuvable: '+str(db))
    if a.apply:upgrade(db)
    else:print('Mode lecture seule — index à ajouter avec --apply')
