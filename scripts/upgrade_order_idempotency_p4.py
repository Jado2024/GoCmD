#!/usr/bin/env python3
"""GoCmd P5.15.29-P4: add optional, durable, per-intent order idempotency.
Offline migration only. Non-destructive: preserves every existing order.
Uses SQLite online backup API, refuses WAL and dirty integrity. --apply required.
"""
import argparse
import datetime
import sqlite3
from pathlib import Path

FIELDS = {"createRequestKey": "TEXT", "createRequestDigest": "TEXT"}
INDEX = "Order_createRequestKey_key"


def upgrade(path: Path, apply: bool = False) -> dict:
    if not path.is_file():
        raise ValueError("Base absente")
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=20) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("La base est invalide avant migration")
        if db.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("Clés étrangères invalides")
        if db.execute("PRAGMA journal_mode").fetchone()[0].lower() != "delete":
            raise ValueError("Migration hors ligne nécessaire (journal DELETE requis)")
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Order'").fetchone():
            raise ValueError("Table Order absente")
        columns = {row[1] for row in db.execute('PRAGMA table_info("Order")')}
        additions = [col for col in FIELDS if col not in columns]
        idx = db.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?", (INDEX,)).fetchone()
        pending_index = not idx
    result = {"add_columns": additions, "add_unique_index": pending_index, "applied": False}
    if not apply or (not additions and not pending_index):
        return result
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = path.with_name(path.name + '.before-p51529p4-' + stamp + '.db')
    # A backup and exclusive maintenance mode are mandatory; no in-place copy of a live DB.
    with sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=30) as src, sqlite3.connect(backup) as dst:
        src.backup(dst)
    with sqlite3.connect(path, timeout=30) as db:
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE')
        try:
            for field in additions:
                db.execute(f'ALTER TABLE "Order" ADD COLUMN "{field}" {FIELDS[field]}')
            db.execute(f'CREATE UNIQUE INDEX IF NOT EXISTS "{INDEX}" ON "Order"("createRequestKey")')
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Integrity check failed after migration')
            if db.execute('PRAGMA foreign_key_check').fetchall():
                raise RuntimeError('Foreign keys failed after migration')
            db.commit()
        except Exception:
            db.rollback()
            raise
    result.update(applied=True, backup=str(backup))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(upgrade(args.db, args.apply))
