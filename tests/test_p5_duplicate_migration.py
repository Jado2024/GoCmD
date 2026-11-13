"""P5 — migration additive, unicité client et contrôle des historiques.
Ne nécessite ni node_modules ni serveur. Tests SQLite réels sur base jetable.
"""
from pathlib import Path
import sqlite3, tempfile, importlib.util

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('migration_p5',ROOT/'scripts/upgrade_customer_order_duplicates_p5.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def fresh(path):
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE "Order" (id INTEGER PRIMARY KEY, ref TEXT UNIQUE, clientId INTEGER, customerOrderNo TEXT, dueDate TEXT)')
        db.execute('INSERT INTO "Order" VALUES (1,"CMD-1",1,"  bc   2026-01  ","2026-11-11T00:00:00Z")')
        db.execute('INSERT INTO "Order" VALUES (2,"CMD-2",2,"BC 2026-01","2026-11-11T00:00:00Z")')
        db.execute('INSERT INTO "Order" VALUES (3,"CMD-3",1,NULL,"2026-11-11T00:00:00Z")')

with tempfile.TemporaryDirectory() as tmp:
    dbfile=Path(tmp)/'fixture.db'; fresh(dbfile)
    preview=m.upgrade(dbfile)
    assert preview['applied'] is False
    assert preview['historical_references']==2
    result=m.upgrade(dbfile,apply=True)
    assert result['applied'] is True and Path(result['backup']).exists()
    with sqlite3.connect(dbfile) as db:
        rows=db.execute('SELECT id,"customerOrderNoNormalized" FROM "Order" ORDER BY id').fetchall()
        assert rows==[(1,'BC 2026-01'),(2,'BC 2026-01'),(3,None)],rows
        assert db.execute('PRAGMA integrity_check').fetchone()==('ok',)
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
        # Même numéro pour un autre client autorisé, pour le même interdit.
        db.execute('INSERT INTO "Order" (id,ref,clientId,customerOrderNoNormalized) VALUES (4,"CMD-4",3,"BC 2026-01")')
        try:
            db.execute('INSERT INTO "Order" (id,ref,clientId,customerOrderNoNormalized) VALUES (5,"CMD-5",1,"BC 2026-01")')
            raise AssertionError('Unicité non appliquée')
        except sqlite3.IntegrityError:pass
    assert m.upgrade(dbfile,apply=True)['applied'] is False

with tempfile.TemporaryDirectory() as tmp:
    dbfile=Path(tmp)/'fixture.db';fresh(dbfile)
    with sqlite3.connect(dbfile) as db:
        db.execute('INSERT INTO "Order" VALUES (4,"CMD-4",1,"BC  2026-01",NULL)')
    before=dbfile.read_bytes()
    try:
        m.upgrade(dbfile,apply=True)
        raise AssertionError('Un doublon historique aurait dû bloquer la migration')
    except ValueError as e:assert 'Doublon' in str(e)
    assert dbfile.read_bytes()==before,'La base a changé malgré un conflit historique'
print('P5 migration — 9 contrôles SQLite PASS')
