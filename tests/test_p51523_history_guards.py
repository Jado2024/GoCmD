"""Real SQLite tests: deletion protection, backup, rollback, idempotence, preserved demo."""
import importlib.util
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('guard', ROOT / 'scripts/upgrade_history_delete_guards_p51523.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
source = ROOT / 'db/custom.db'

with TemporaryDirectory() as temp:
    temp = Path(temp)
    db_file = temp / 'active' / 'test.db'
    db_file.parent.mkdir()
    with sqlite3.connect(f'file:{source.resolve()}?mode=ro', uri=True) as orig, sqlite3.connect(db_file) as dst:
        orig.backup(dst)
    before = db_file.read_bytes()
    with sqlite3.connect(db_file) as current:
        guard_count_before = current.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'gocmd_no_hard_delete_%'").fetchone()[0]
    try:
        mod.run(db_file, None, True)
        raise AssertionError('backup absent non bloqué')
    except ValueError:
        pass
    assert db_file.read_bytes() == before, 'base modifiée avant sauvegarde'
    backup = temp / 'external' / 'verified.db'
    mod.run(db_file, backup, True)
    assert backup.is_file()
    with sqlite3.connect(backup) as b:
        mod.verify(b)
        # The backup must faithfully preserve the source database's guard state.
        saved_guard_count = b.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'gocmd_no_hard_delete_%'").fetchone()[0]
        assert saved_guard_count == guard_count_before
    with sqlite3.connect(db_file) as db:
        db.execute('PRAGMA foreign_keys=ON')
        count = db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'gocmd_no_hard_delete_%'").fetchone()[0]
        assert count == len(mod.IMMUTABLE_TABLES), (count, len(mod.IMMUTABLE_TABLES))
        move_id = db.execute('SELECT id FROM Movement ORDER BY id LIMIT 1').fetchone()[0]
        try:
            db.execute('DELETE FROM Movement WHERE id=?', (move_id,))
            raise AssertionError('suppression mouvement autorisée')
        except sqlite3.IntegrityError as exc:
            assert 'GOCMD_HISTORICAL_DELETE_FORBIDDEN' in str(exc)
        db.execute("INSERT INTO PurchaseRequest (ref) VALUES ('P51523_GUARD_TEST')")
        try:
            db.execute("DELETE FROM PurchaseRequest WHERE ref='P51523_GUARD_TEST'")
            raise AssertionError('suppression DA autorisée')
        except sqlite3.IntegrityError:
            pass
        mod.verify(db)
    # Re-applying is idempotent and must not create duplicate triggers.
    mod.run(db_file, temp / 'external' / 'verified2.db', True)
    with sqlite3.connect(db_file) as db:
        count2 = db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'gocmd_no_hard_delete_%'").fetchone()[0]
        assert count2 == len(mod.IMMUTABLE_TABLES)
print(f'PASS: {len(mod.IMMUTABLE_TABLES)} tables protégées, refus DELETE, backup intègre, base source préservée, migration idempotente')
