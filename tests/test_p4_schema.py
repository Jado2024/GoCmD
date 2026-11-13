"""P4 idempotency migration: real SQLite database on disposable copy only."""
import importlib.util
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('idem_migration', ROOT / 'scripts/upgrade_order_idempotency_p4.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

with tempfile.TemporaryDirectory() as temp:
    dbfile = Path(temp)/'test.db'
    with sqlite3.connect(dbfile) as db:
        db.execute('CREATE TABLE "Order" (id INTEGER PRIMARY KEY, ref TEXT UNIQUE, createdBy TEXT)')
        db.execute('INSERT INTO "Order" (id,ref,createdBy) VALUES (1,"CMD-TEST-1","sales")')
    assert m.upgrade(dbfile)['add_columns'] == ['createRequestKey','createRequestDigest']
    assert m.upgrade(dbfile, True)['applied']
    assert m.upgrade(dbfile, True)['applied'] is False
    with sqlite3.connect(dbfile) as db:
        assert db.execute('SELECT ref,createRequestKey FROM "Order" WHERE id=1').fetchone() == ('CMD-TEST-1',None)
        db.execute('INSERT INTO "Order" (id,ref,createdBy,createRequestKey,createRequestDigest) VALUES (2,"CMD-TEST-2","sales","hash-1","digest-1")')
        try:
            db.execute('INSERT INTO "Order" (id,ref,createdBy,createRequestKey) VALUES (3,"CMD-TEST-3","sales","hash-1")')
        except sqlite3.IntegrityError:
            pass
        else:
            raise AssertionError('Unique key failed')
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
print('PASS P4: migration additive/idempotente, intégrité, clé unique, historique conservé')
