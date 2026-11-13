#!/usr/bin/env python3
"""Upgrade non destructif: sauvegarde SQLite cohérente puis index liste CMD.

Utilisation sur COPIE de recette ou en fenêtre de maintenance après arrêt
contrôlé du service. Refuse explicitement le fichier DEMO fourni.
"""
import argparse
import datetime as dt
import hashlib
import pathlib
import sqlite3
import sys

ROOT=pathlib.Path(__file__).resolve().parent.parent
DEMO=(ROOT/'db'/'custom.db').resolve()


def sha256(path):
    h=hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda:handle.read(1<<20),b''):h.update(chunk)
    return h.hexdigest()


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--db',required=True,help='Chemin vers une COPIE de recette ou BDD de maintenance hors ligne')
    ap.add_argument('--backup',required=True,help='Nouveau fichier de sauvegarde SQLite, distinct de la source')
    ap.add_argument('--apply',action='store_true',help='Autorisation explicite (sans ce drapeau aucune modification)')
    a=ap.parse_args()
    source=pathlib.Path(a.db).expanduser().resolve()
    backup=pathlib.Path(a.backup).expanduser().resolve()
    if source==DEMO or not source.is_file() or backup==source or backup.exists() or not a.apply:
        print('REFUS: --apply, BDD existante non livrée et chemin de sauvegarde neuf sont obligatoires',file=sys.stderr)
        return 2
    # Le service doit être arrêté; refuser les indicateurs habituels de verrou d'exploitation.
    if any(source.parent.glob(source.name+'.*lock*')):
        print('REFUS: un verrou d exploitation est présent',file=sys.stderr);return 2
    backup.parent.mkdir(parents=True,exist_ok=True)
    try:
        with sqlite3.connect(f'file:{source}?mode=rw',uri=True,timeout=3) as conn:
            conn.execute('PRAGMA busy_timeout=3000')
            assert conn.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            if conn.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('FK invalides')
            with sqlite3.connect(str(backup)) as dest:conn.backup(dest)
            # Écriture atomique ; abandon sans suppression si une autre instance bloque la base.
            conn.execute('BEGIN IMMEDIATE')
            conn.execute('CREATE INDEX IF NOT EXISTS "Order_createdAt_id_idx" ON "Order" ("createdAt" DESC,"id" DESC)')
            conn.commit()
            assert conn.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            if conn.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('FK invalides après index')
            plan=conn.execute('EXPLAIN QUERY PLAN SELECT id FROM "Order" ORDER BY "createdAt" DESC,"id" DESC LIMIT 50').fetchall()
            if not any('Order_createdAt_id_idx' in row[3] for row in plan):raise RuntimeError('Index absent du plan')
        print('PASS: index et intégrité SQLite; sauvegarde='+str(backup)+' SHA256='+sha256(backup))
        return 0
    except Exception as exc:
        print('ECHEC: '+str(exc),file=sys.stderr);return 1

if __name__=='__main__':sys.exit(main())
