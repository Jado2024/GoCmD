#!/usr/bin/env python3
"""Read-only check of an R11 order index; never modifies the supplied DB."""
import argparse
import pathlib
import sqlite3
import sys

def verify(path):
    file=pathlib.Path(path).expanduser().resolve()
    if not file.is_file():raise RuntimeError('Fichier SQLite absent')
    with sqlite3.connect(f'file:{file}?mode=ro',uri=True) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('DB non intègre')
        if db.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('FK orphelines')
        indexes=db.execute('PRAGMA index_list("Order")').fetchall()
        if not any(i[1]=='Order_createdAt_id_idx' for i in indexes):raise RuntimeError('Index Order_createdAt_id_idx manquant')
        x=db.execute('PRAGMA index_xinfo("Order_createdAt_id_idx")').fetchall()
        cols=[(r[2],r[3]) for r in x if r[5]]
        if cols!=[('createdAt',1),('id',1)]:raise RuntimeError('Colonnes ou sens de tri incorrects: '+str(cols))
        plan=db.execute('EXPLAIN QUERY PLAN SELECT id FROM "Order" ORDER BY "createdAt" DESC, "id" DESC LIMIT 50').fetchall()
        if not any('Order_createdAt_id_idx' in r[3] for r in plan):raise RuntimeError('Index non utilisé par le plan SQL')
        print('PASS R12: index présent, DESC/DESC, plan SQL, intégrité et FK')

def main():
    p=argparse.ArgumentParser();p.add_argument('--db',required=True);args=p.parse_args()
    try:verify(args.db);return 0
    except Exception as exc:print('FAIL R12:',exc,file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
