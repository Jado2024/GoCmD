#!/usr/bin/env python3
"""Protect the Material master table against physical DELETE (audit 10/11/2026).

Gravité P1 (DB-HIST-02) : la colonne Movement.materialId est déclarée
ON DELETE SET NULL dans le DDL réel, et Material n'était couvert par AUCUN
des 19 triggers gocmd_no_hard_delete_*. Un DELETE SQL direct d'une matière
détachait donc SILENCIEUSEusement tout l'historique des mouvements de stock
(StockLot a un trigger, mais Movement perdait son lien matière).

Cette migration additive installe le même garde BEFORE DELETE ABORT sur
Material. Idempotente, transactionnelle (BEGIN IMMEDIATE), sauvegarde
externe obligatoire, contrôles d'intégrité avant/après.

Usage :
  python scripts/upgrade_material_delete_guard_20261110.py --db PRODUCTION.db \
      --backup /autre/dossier/before_material_guard.db --apply
"""
import argparse
from pathlib import Path
import sqlite3

GUARD_TABLES = ('Material',)
TRIGGER = 'gocmd_no_hard_delete_material'


def verify(db: sqlite3.Connection) -> None:
    db.execute('PRAGMA foreign_keys=ON')
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise RuntimeError('SQLite integrity_check failed')
    if db.execute('PRAGMA foreign_key_check').fetchone():
        raise RuntimeError('SQLite foreign_key_check failed')


def run(db_path: Path, backup_path: Path | None = None, apply: bool = False) -> None:
    db_path = db_path.expanduser().resolve()
    if not db_path.is_file():
        raise FileNotFoundError(f'Base absente : {db_path}')
    with sqlite3.connect(f'file:{db_path}?mode=ro', uri=True) as db:
        verify(db)
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        have_trigger = db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?", (TRIGGER,)).fetchone()[0]
    missing = set(GUARD_TABLES) - tables
    if missing:
        raise RuntimeError(f'Schéma incompatible : tables absentes {sorted(missing)}')
    if have_trigger:
        print('DÉJÀ PROTÉGÉ :', TRIGGER, '(aucune modification)')
        return
    if not apply:
        print('PREVIEW OK — table à protéger :', ', '.join(GUARD_TABLES), '(ajouter --apply + --backup externe)')
        return
    if backup_path is None:
        raise ValueError('Sauvegarde externe obligatoire : --backup')
    backup_path = backup_path.expanduser().resolve()
    if backup_path == db_path or backup_path.exists() or (backup_path.parent == db_path.parent or backup_path.parent.is_relative_to(db_path.parent)):
        raise ValueError('Sauvegarde distincte, nouvelle et dans un dossier externe obligatoire')
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f'file:{db_path}?mode=ro', uri=True) as src, sqlite3.connect(backup_path) as dst:
        src.backup(dst)
        verify(dst)
    with sqlite3.connect(str(db_path), timeout=30) as db:
        db.execute('PRAGMA busy_timeout=30000')
        verify(db)
        try:
            db.execute('BEGIN IMMEDIATE')
            for table in GUARD_TABLES:
                db.execute(f'''CREATE TRIGGER IF NOT EXISTS "{TRIGGER}"
                    BEFORE DELETE ON "{table}" BEGIN
                    SELECT RAISE(ABORT, 'GOCMD_HISTORICAL_DELETE_FORBIDDEN');
                    END''')
            verify(db)
            db.execute('COMMIT')
        except BaseException:
            db.execute('ROLLBACK')
            raise
    print('PROTECTION OK :', ', '.join(GUARD_TABLES), '; sauvegarde :', backup_path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True, type=Path)
    parser.add_argument('--backup', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    run(args.db, args.backup, args.apply)
