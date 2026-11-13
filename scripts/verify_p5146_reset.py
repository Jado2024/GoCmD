#!/usr/bin/env python3
"""GoCmd P5.14.6: regression of reset from a safe, isolated DB copy."""
from __future__ import annotations
from contextlib import closing
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import shutil

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'db' / 'custom.db'
SCRIPT = ROOT / 'scripts' / 'prepare_demo_p5143.py'

def load():
    spec = importlib.util.spec_from_file_location('gocmd_p5146_reset', SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def run():
    if not BASE.is_file():
        raise SystemExit('Base de demonstration source absente : '+str(BASE))
    with tempfile.TemporaryDirectory(prefix='gocmd_p5146_test_') as folder:
        destination = Path(folder) / 'custom.db'
        with closing(sqlite3.connect(str(BASE))) as source, closing(sqlite3.connect(str(destination))) as target:
            source.backup(target)
        with closing(sqlite3.connect(str(destination))) as con:
            people = {t:con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in ('GoCmdUser','Client','Product')}
        mod=load()
        # Re-run twice to check idempotence and atomic os.replace in one process.
        for index in range(2):
            mod.prepare(destination)
            with closing(sqlite3.connect(str(destination))) as con:
                assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
                assert not con.execute('PRAGMA foreign_key_check').fetchall()
                assert con.execute('SELECT COUNT(*) FROM Material').fetchone()[0]==59
                assert con.execute('SELECT COUNT(*) FROM Supplier').fetchone()[0]==11
                assert con.execute('SELECT COUNT(*) FROM PurchaseRequest').fetchone()[0]==0
                assert con.execute('SELECT COUNT(*) FROM SupplierConsultation').fetchone()[0]==0
                assert con.execute('SELECT COUNT(*) FROM SupplierMaterial').fetchone()[0]==109
                assert all(con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]==v for t,v in people.items())
            assert not list(destination.parent.glob('.p5143_work_*.db')), 'Fichier temporaire residuel'
        print('PASS P5.14.6 : deux remises a zero sur copie, migration, stocks/lots, integrite et comptes conserves.')
if __name__=='__main__': run()
