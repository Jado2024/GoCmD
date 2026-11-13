"""Independent checks on a disposable SQLite COPY, including rollback and existing data."""
import hashlib
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from upgrade_award_contracts_p51519 import upgrade
from check_sqlite_schema_p5157 import inspect_db

class ContractMigration(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'recipe.db'
        shutil.copy2(ROOT/'db/custom.db',self.path)
        self.sha=hashlib.sha256((ROOT/'db/custom.db').read_bytes()).hexdigest()
    def tearDown(self):
        self.assertEqual(self.sha,hashlib.sha256((ROOT/'db/custom.db').read_bytes()).hexdigest())
        self.tmp.cleanup()
    def test_01_idempotence(self):
        upgrade(self.path,True)
        upgrade(self.path,True)
        with sqlite3.connect(self.path) as c:
            self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])
    def test_02_historical_unchanged(self):
        with sqlite3.connect(self.path) as c:
            before={name:c.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0] for name in ['SupplierAwardPlan','SupplierQuoteOffer','SupplierOrder','SupplierOrderLine','SupplierPriceAgreement']}
        upgrade(self.path,True)
        with sqlite3.connect(self.path) as c:
            after={name:c.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0] for name in before}
            self.assertEqual(before,after)
    def test_03_additive_rollback_and_uniqueness(self):
        upgrade(self.path,True)
        with sqlite3.connect(self.path) as c:
            c.execute('PRAGMA foreign_keys=ON')
            self.assertTrue(c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='SupplierAwardContractAllocation'").fetchone())
            c.execute('BEGIN')
            try:
                c.execute('INSERT INTO SupplierAwardContractAllocation(planId,agreementId,qty,unitPrice) VALUES(999999,999999,60,125)')
            except sqlite3.IntegrityError:
                pass
            else:
                self.fail('Expected a FK refusal')
            c.rollback()
            self.assertEqual(c.execute('SELECT count(*) FROM SupplierAwardContractAllocation').fetchone()[0],0)
    def test_05_invalid_foreign_keys_do_not_leave_schema_changes(self):
        with sqlite3.connect(self.path) as c:
            c.execute('DROP TABLE SupplierAwardContractAllocation')
            c.execute('CREATE TABLE invalid_fixture (supplierId INTEGER REFERENCES Supplier(id))')
            c.execute('INSERT INTO invalid_fixture VALUES (999999)')
        before = self.path.read_bytes()
        for apply in (False, True):
            with self.assertRaisesRegex(ValueError, 'Violations FK'):
                upgrade(self.path, apply)
            self.assertEqual(self.path.read_bytes(), before)

    def test_07_startup_requires_contract_migration(self):
        with sqlite3.connect(self.path) as c:
            c.execute('DROP TABLE SupplierAwardContractAllocation')
        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'Migration P5.15.19 manquante'):
            inspect_db(self.path)
        self.assertEqual(self.path.read_bytes(), before)
        upgrade(self.path, True)
        inspect_db(self.path)

    def test_06_error_during_ddl_rolls_back_earlier_statement(self):
        with sqlite3.connect(self.path) as c:
            c.execute('DROP TABLE SupplierAwardContractAllocation')
            c.execute('CREATE TABLE SupplierAwardContractAllocation_plan_agreement_key (id INTEGER)')
        before = self.path.read_bytes()
        with self.assertRaises(sqlite3.OperationalError):
            upgrade(self.path, True)
        self.assertEqual(self.path.read_bytes(), before)

    def test_04_no_implicit_database_creation(self):
        with self.assertRaises(ValueError):
            upgrade(Path(self.tmp.name)/'missing.db',True)
        self.assertFalse((Path(self.tmp.name)/'missing.db').exists())

if __name__=='__main__':unittest.main(verbosity=2)
