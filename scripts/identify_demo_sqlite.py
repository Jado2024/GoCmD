#!/usr/bin/env python3
"""Identify a synthetic GoCmd database by content rather than name/path."""
import argparse
from pathlib import Path
import sqlite3
p=argparse.ArgumentParser();p.add_argument('--db',type=Path,required=True);a=p.parse_args()
with sqlite3.connect(f'file:{a.db.resolve()}?mode=ro',uri=True) as db:
    if db.execute("PRAGMA integrity_check").fetchone()[0]!="ok":
        p.error('SQLite integrity invalid')
    have=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='WarehouseSite'").fetchone()
    if not have:
        p.error('WarehouseSite absent : base non GoCmd')
    marker=db.execute("SELECT 1 FROM WarehouseSite WHERE code='SODEPI-DEMO' LIMIT 1").fetchone()
print('DEMO' if marker else 'OPERATIONAL')
