#!/usr/bin/env python3
"""P6 cascade: missing Prisma index must be repaired on a partially upgraded DB.

Runs on an isolated SQLite backup, never on the shipped demonstration database.
"""
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'db' / 'custom.db'
INDEX = 'SalesStockReservation_engagedAt_idx'

with tempfile.TemporaryDirectory(prefix='gocmd_cascade_idx_') as td:
    target = Path(td) / 'demo.db'
    with sqlite3.connect(f'file:{SOURCE.as_posix()}?mode=ro', uri=True) as original, sqlite3.connect(target) as copy:
        original.backup(copy)
    with sqlite3.connect(target) as db:
        db.execute(f'DROP INDEX IF EXISTS "{INDEX}"')
        assert not db.execute('SELECT 1 FROM sqlite_master WHERE type="index" AND name=?', (INDEX,)).fetchone()
        before = {t: db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
                  for t in ('Material', 'StockLot', 'Product', 'GoCmdUser', 'Order', 'AuditEvent')}
    migration = ['python', str(ROOT / 'scripts' / 'upgrade_reservation_engagement_p6.py'),
                 '--db', str(target), '--apply']
    p = subprocess.run(migration, capture_output=True, text=True, timeout=25)
    assert p.returncode == 0, p.stdout + '\n' + p.stderr
    with sqlite3.connect(target) as db:
        assert db.execute('SELECT 1 FROM sqlite_master WHERE type="index" AND name=?', (INDEX,)).fetchone()
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        after = {t: db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in before}
        assert before == after, (before, after)
    # No-op repeated migrations must be safe and avoid a second snapshot.
    saved = list(Path(td).glob('demo.avant_anciennete_p6_*.db'))
    assert len(saved) == 1, saved
    q = subprocess.run(migration, capture_output=True, text=True, timeout=15)
    assert q.returncode == 0, q.stdout + '\n' + q.stderr
    assert len(list(Path(td).glob('demo.avant_anciennete_p6_*.db'))) == 1
print('CASCADE P6 INDEX DRIFT: PASS — index recovered, rows unchanged, FK/integrity OK, idempotent')
