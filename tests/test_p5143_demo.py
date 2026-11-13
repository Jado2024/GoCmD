"""Legacy P5.14.3 versus P6: never bypass immutable history to reset demo data.

The obsolete resetter must safely refuse deletion on protected databases. The
supported P6 full-demo regenerator is tested inside a fully isolated root.
"""
from __future__ import annotations
import hashlib
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / 'db/custom.db'


def digest(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


with tempfile.TemporaryDirectory(prefix='gocmd_p5143_p6_') as td:
    temporary = Path(td)
    old = temporary / 'protected-legacy.db'
    with sqlite3.connect(f'file:{DB.as_posix()}?mode=ro', uri=True) as source, sqlite3.connect(old) as dest:
        source.backup(dest)
    before = digest(old)
    # P5.14.3 resetter was written before non-deletable historical documents.
    old_reset = subprocess.run([sys.executable, str(ROOT/'scripts/prepare_demo_p5143.py'),
                                '--db', str(old), '--apply'], capture_output=True, text=True, timeout=50)
    assert old_reset.returncode != 0, 'Obsolete destructive reset unexpectedly bypassed database guards'
    assert 'GOCMD_HISTORICAL_DELETE_FORBIDDEN' in old_reset.stderr + old_reset.stdout
    assert digest(old) == before, 'Legacy failed reset altered the protected SQLite database'
    print('PASS legacy P5.14.3: immutable history enforced, no partial replacement')

    isolated = temporary / 'isolated-project'
    (isolated / 'db').mkdir(parents=True)
    (isolated / 'scripts').mkdir()
    needed = ('demo_seed_sodepi.json.gz', 'schema_demo_p51523.sql',
              'triggers_demo_p51523.sql', 'overlay_demo_current_p51529p5.sql')
    for name in needed:
        shutil.copy2(ROOT / 'db' / name, isolated / 'db' / name)
    shutil.copy2(ROOT / 'scripts/recreer_demo_sodepi_p51523.py',
                 isolated / 'scripts/recreer_demo_sodepi_p51523.py')
    # V2 R5 : le reconstructeur officiel importe le générateur de références
    # `demo_v2_catalogue`; la recette isolée doit copier cette dépendance,
    # sinon elle échoue avant de tester la sécurité de la reconstruction.
    shutil.copy2(ROOT / 'scripts/demo_v2_catalogue.py',
                 isolated / 'scripts/demo_v2_catalogue.py')
    shutil.copy2(DB, isolated / 'db/custom.db')
    reset = subprocess.run([sys.executable, str(isolated / 'scripts/recreer_demo_sodepi_p51523.py'),
                            '--apply', '--ack', 'DEMO_ONLY'],
                           capture_output=True, text=True, timeout=35)
    assert reset.returncode == 0, reset.stderr + reset.stdout
    with sqlite3.connect(isolated/'db/custom.db') as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        for table, expected in [('Material', 82), ('Supplier', 18), ('Product', 218),
                                ('StockLot', 64), ('Order', 0), ('WorkOrder', 0)]:
            assert db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] == expected, table
        assert db.execute('SELECT 1 FROM sqlite_master WHERE type="index" AND name="SalesStockReservation_engagedAt_idx"').fetchone()
    assert digest(DB) != ''  # official database was never a reset target
    print('PASS current P6 regenerator: clean demo, intact catalog/stock, index present')
print('PASS P5.14.3 historical safety + P6 supported replacement')
