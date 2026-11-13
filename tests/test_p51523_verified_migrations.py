"""Safe legacy migration runner: dry-run, full backup, reject destructive paths."""
import importlib.util
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('runner', ROOT / 'scripts/run_verified_schema_upgrade_p51523.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
with TemporaryDirectory() as temp:
    temp = Path(temp)
    db = temp/'working'/'demo.db'
    db.parent.mkdir()
    with sqlite3.connect(f'file:{(ROOT/'db/custom.db').resolve()}?mode=ro', uri=True) as src, sqlite3.connect(db) as dst:
        src.backup(dst)
    counts = mod.verify(db)
    try:
        mod.perform(db,temp/'backup','upgrade_suppliers_p510.py','',True)
        raise AssertionError('offline confirmation absent accepted')
    except ValueError: pass
    try:
        mod.perform(db,db.parent,'upgrade_suppliers_p510.py','YES_OFFLINE',True)
        raise AssertionError('backup in db directory accepted')
    except ValueError: pass
    assert mod.perform(db,temp/'backup','upgrade_suppliers_p510.py','YES_OFFLINE',False) is None
    saved=mod.perform(db,temp/'backup','upgrade_suppliers_p510.py','YES_OFFLINE',True)
    assert saved.is_file() and mod.verify(saved) == counts
    assert mod.verify(db) == counts
    try:
        mod.perform(db,temp/'backup','reinitialiser_demo_v16.py','YES_OFFLINE',True)
        raise AssertionError('destructive demo reset accepted')
    except ValueError: pass
print('PASS: validation copie, sauvegarde externe, migrations idempotentes, scripts dangereux bloqués')
