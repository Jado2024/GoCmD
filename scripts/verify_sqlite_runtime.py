#!/usr/bin/env python3
"""P5.15.28 P1: refuse unsafe WAL until all embedded SQLite engines are vetted.

Default policy: SQLite rollback journal (DELETE), avoiding the WAL-reset race even
with older SQLite binaries. Offline transition is explicit and requires a backup.
This command must be run while ALL GoCmd processes are stopped.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from contextlib import closing
import sqlite3
import sys


def check(db_path: Path, *, switch: bool = False, backup_file: Path | None = None) -> dict:
    db_path = db_path.expanduser().resolve()
    if not db_path.is_file():
        raise ValueError('Base SQLite introuvable')
    with closing(sqlite3.connect(f'file:{db_path.as_posix()}?mode=ro', uri=True, timeout=5)) as ro:
        prior = str(ro.execute('PRAGMA journal_mode').fetchone()[0]).lower()
        if ro.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('integrity_check en échec — arrêt immédiat')
        if ro.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('foreign_key_check en échec — arrêt immédiat')
    if switch:
        if backup_file is None:
            raise ValueError('Une sauvegarde externe --backup-file est obligatoire')
        backup_file = backup_file.expanduser().resolve()
        if backup_file == db_path or backup_file.exists() or backup_file.parent == db_path.parent:
            raise ValueError('Sauvegarde externe distincte et inexistante obligatoire')
        backup_file.parent.mkdir(parents=True, exist_ok=True)
        try:
            with closing(sqlite3.connect(f'file:{db_path.as_posix()}?mode=ro', uri=True, timeout=30)) as src:
                with closing(sqlite3.connect(backup_file)) as dst:
                    src.backup(dst)
            with closing(sqlite3.connect(backup_file)) as bak:
                if bak.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('Sauvegarde de précaution invalide')
                if bak.execute('PRAGMA foreign_key_check').fetchone():
                    raise ValueError('FK invalides dans la sauvegarde')
            with closing(sqlite3.connect(db_path, timeout=5)) as writable:
                mode = str(writable.execute('PRAGMA journal_mode=DELETE').fetchone()[0]).lower()
                if mode != 'delete':
                    raise ValueError(f'Journal inattendu après conversion : {mode}')
        except Exception:
            # Keep any already verified backup for controlled recovery.
            raise
    with closing(sqlite3.connect(f'file:{db_path.as_posix()}?mode=ro', uri=True, timeout=5)) as ro:
        current = str(ro.execute('PRAGMA journal_mode').fetchone()[0]).lower()
        integrity = ro.execute('PRAGMA integrity_check').fetchone()[0]
        fk = ro.execute('PRAGMA foreign_key_check').fetchone()
        fk_setting = int(ro.execute('PRAGMA foreign_keys').fetchone()[0])
    if current != 'delete':
        raise ValueError('P1 SQLite/WAL : mode '+current+' refusé. Arrêter GoCmd et exécuter la conversion explicite avec une sauvegarde externe.')
    if integrity != 'ok' or fk:
        raise ValueError('Contrôles SQLite après conversion en échec')
    return {'sqlite_python': sqlite3.sqlite_version, 'journal_before': prior, 'journal_after': current,
            'integrity': integrity, 'foreign_key_check_passed': fk is None,
            'foreign_keys_connection_enabled': bool(fk_setting),
            'foreign_keys_connection_note': 'Cette mesure porte sur la connexion de contrôle Python, pas sur le pool Prisma',
            'policy': 'ROLLBACK_DELETE'}


def main() -> int:
    ap = argparse.ArgumentParser(description='Garde SQLite P1 — mode rollback DELETE, vérification intègre')
    ap.add_argument('--db', type=Path, required=True)
    ap.add_argument('--set-rollback', action='store_true', help='Conversion explicite à exécuter hors ligne')
    ap.add_argument('--ack', default='', help='MAINTENANCE_WINDOW obligatoire pour conversion')
    ap.add_argument('--backup-file', type=Path)
    args = ap.parse_args()
    if args.set_rollback and args.ack != 'MAINTENANCE_WINDOW':
        ap.error('--ack MAINTENANCE_WINDOW requis ; arrêter les serveurs au préalable')
    try:
        print(json.dumps(check(args.db, switch=args.set_rollback, backup_file=args.backup_file), ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f'P1 SQLITE REFUS : {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
