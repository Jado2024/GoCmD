"""Tests idempotence + non-destruction + colonnes d'immuabilité VEN-02."""
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
ROOT = Path(__file__).resolve().parents[1]
sp = importlib.util.spec_from_file_location('sales_snapshots', ROOT / 'scripts/upgrade_sales_snapshots_p51521.py')
mod = importlib.util.module_from_spec(sp)
sp.loader.exec_module(mod)
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / 'test.db'
    with sqlite3.connect(path) as con:
        for table in mod.COLUMNS:
            con.execute(f'CREATE TABLE "{table}" (id INTEGER PRIMARY KEY, sentinel TEXT)')
            con.execute(f'INSERT INTO "{table}" (sentinel) VALUES (?)', (table,))
    expected=sum(map(len,mod.COLUMNS.values()))
    assert len(mod.run(path))==expected
    with sqlite3.connect(path) as con:
        assert all(len(list(con.execute(f'PRAGMA table_info("{table}")')))==2 for table in mod.COLUMNS)
    assert len(mod.run(path, True))==expected
    assert mod.run(path,True)==[]
    with sqlite3.connect(path) as con:
        assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
        for table, cols in mod.COLUMNS.items():
            fields={row[1] for row in con.execute(f'PRAGMA table_info("{table}")')}
            assert {name for name,_ in cols}<=fields
            assert con.execute(f'SELECT sentinel FROM "{table}"').fetchone()[0]==table
    assert len(list(Path(tmp).glob('*.avant_snapshots_ventes_*.db')))==1
print('PASS VEN-02: migration idempotente, copie de sécurité, lignes historiques préservées')
