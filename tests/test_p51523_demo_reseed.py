"""Verify demo reset really rebuilds a fresh SQLite DB, not just clearing screens."""
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = ['schema_demo_p51523.sql','triggers_demo_p51523.sql','demo_seed_sodepi.json.gz','overlay_demo_current_p51529p5.sql']
with tempfile.TemporaryDirectory(prefix='gocmd_reset_validation_') as temp:
    root = Path(temp)
    (root / 'scripts').mkdir()
    (root / 'db').mkdir()
    shutil.copy2(ROOT / 'scripts/recreer_demo_sodepi_p51523.py', root / 'scripts')
    shutil.copy2(ROOT / 'scripts/demo_v2_catalogue.py', root / 'scripts')
    for name in NAMES:
        shutil.copy2(ROOT / 'db' / name, root / 'db')
    dbfile = root / 'db/custom.db'
    # L'archive source est une DEMO prouvée ; partir d'une copie portant son
    # marqueur avant d'injecter les opérations fictives à effacer.
    shutil.copy2(ROOT / 'db/custom.db', dbfile)
    with sqlite3.connect(dbfile) as db:
        db.execute('CREATE TABLE bogus_old_state (value TEXT)')
        db.execute("INSERT INTO bogus_old_state VALUES ('old demonstration')")
    cmd = [sys.executable, str(root / 'scripts/recreer_demo_sodepi_p51523.py'), '--apply', '--ack', 'DEMO_ONLY']
    for repeat in (1, 2):
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0, (result.stdout, result.stderr)
        with sqlite3.connect(dbfile) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert db.execute('PRAGMA foreign_key_check').fetchall() == []
            assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='bogus_old_state'").fetchone()[0] == 0
            for table, expected in {'Material':82,'Supplier':18,'SupplierMaterial':135,'Product':218,'Client':10,'StockLot':64,'GoCmdUser':9}.items():
                actual = db.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
                assert actual == expected, (table, actual)
            for table in ('Order','PurchaseRequest','WorkOrder','SalesInvoice','GoCmdSession','GoCmdAccessAudit','SupplierOrder','SalesQuote'):
                assert db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] == 0, table
            assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0] == 73
            assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger'").fetchone()[0] == 59
            assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'gocmd_no_hard_delete_%'").fetchone()[0] == 20
            assert db.execute('SELECT count(*) FROM Material WHERE canonicalIdentity IS NOT NULL').fetchone()[0]==82
            assert db.execute('SELECT count(*) FROM Product WHERE canonicalIdentity IS NOT NULL').fetchone()[0]==218
            assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'gocmd_invoice_lock_%'").fetchone()[0] == 6
        if repeat == 1:
            with sqlite3.connect(dbfile) as db:
                db.execute("INSERT INTO PurchaseRequest(ref) VALUES ('OLD_DA_TO_DELETE')")
    assert not (root / 'db/custom.db-wal').exists()
    # Un fichier sans marqueur DEMO doit être strictement préservé.
    with sqlite3.connect(dbfile) as db:
        db.execute("UPDATE WarehouseSite SET code='PRODUCTION' WHERE code='SODEPI-DEMO'")
    rejected=subprocess.run(cmd,capture_output=True,text=True)
    assert rejected.returncode!=0 and 'non identifiée DEMO' in rejected.stderr
    with sqlite3.connect(dbfile) as db:
        assert db.execute("SELECT count(*) FROM WarehouseSite WHERE code='PRODUCTION'").fetchone()[0]==1

print('PASS V2: deletion+recreation twice, 82 MP, 18 suppliers, 135 links, 218 products, no old DA/orders, 20 delete guards (avec Material, audit 2026-11-10) + 6 invoice guards')
