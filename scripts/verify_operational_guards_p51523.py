#!/usr/bin/env python3
"""Block checked startup if history / invoice protections were not migrated.

Never modifies the database. Install migrations against an external backup first.
"""
import argparse
from pathlib import Path
import sqlite3

def main(path: Path):
    with sqlite3.connect(f'file:{path.expanduser().resolve()}?mode=ro',uri=True) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
            raise RuntimeError('SQLite integrity check failed')
        if db.execute('PRAGMA foreign_key_check').fetchone():
            raise RuntimeError('SQLite FK check failed')
        n1=db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'gocmd_no_hard_delete_%'").fetchone()[0]
        n2=db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'gocmd_invoice_lock_%'").fetchone()[0]
        if n1!=20 or n2!=6:
            raise RuntimeError(f'Protections incomplètes: suppressions={n1}/20, factures={n2}/6. Appliquer les migrations upgrade_history_delete_guards_p51523.py (avec Material depuis l\'audit 10/11/2026) et upgrade_invoice_immutability_p51523.py sur une copie sauvegardée.')
        print('PASS: history protection 20/20, invoice protection 6/6')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',required=True,type=Path);a=p.parse_args()
    try:main(a.db)
    except (OSError,sqlite3.Error,RuntimeError) as e:raise SystemExit(str(e))
