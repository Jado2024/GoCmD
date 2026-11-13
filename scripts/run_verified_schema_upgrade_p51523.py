#!/usr/bin/env python3
"""Run a legacy additive migration with preflight on a copy and external backup.

GoCmd must be STOPPED: this tool cannot guarantee the absence of concurrent writers.
Example:
 python scripts/run_verified_schema_upgrade_p51523.py --db /data/gocmd.db \
   --backup-dir /separate/backups --script upgrade_suppliers_p510.py \
   --offline-confirm YES_OFFLINE --apply

On migration failure, backup is retained. Restoration is ALWAYS a manual,
reviewed operation; never automatically overwrite live changes.
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
# These are additive schema-only scripts with the common --db / --apply contract.
APPROVED = {
    'upgrade_foam_catalogue_p55.py', 'upgrade_suppliers_p510.py',
    'upgrade_sourcing_p511.py', 'upgrade_procurement_p513.py',
    'upgrade_phone_offers_p51515.py', 'upgrade_da_line_approval_p5150.py',
    'upgrade_award_contracts_p51519.py',
}


def verify(path: Path) -> dict[str, int]:
    with sqlite3.connect(f'file:{path.resolve()}?mode=ro', uri=True) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError(f'Base SQLite invalide : {path}')
        if db.execute('PRAGMA foreign_key_check').fetchone():
            raise RuntimeError(f'Clés étrangères invalides : {path}')
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {t: db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}


def backup(source: Path, destination: Path) -> None:
    with sqlite3.connect(f'file:{source.resolve()}?mode=ro', uri=True) as src, sqlite3.connect(destination) as dst:
        src.backup(dst)
    verify(destination)


def perform(db_path: Path, backup_dir: Path, script: str, ack: str, apply: bool) -> Path | None:
    db_path = db_path.expanduser().resolve()
    backup_dir = backup_dir.expanduser().resolve()
    if not db_path.is_file():
        raise FileNotFoundError('Base SQLite absente')
    if script not in APPROVED or not (ROOT / script).is_file():
        raise ValueError('Migration non autorisée par ce lanceur : vérifier manuellement ce script')
    if ack != 'YES_OFFLINE':
        raise ValueError('Arrêter GoCmd puis fournir --offline-confirm YES_OFFLINE')
    if backup_dir == db_path.parent or backup_dir.is_relative_to(db_path.parent):
        raise ValueError('Sauvegardes dans un répertoire externe au dossier de la base')
    original_counts = verify(db_path)
    if not apply:
        print('PREVIEW OK :', script, 'base et', len(original_counts), 'tables vérifiées ; --apply requis')
        return None
    with tempfile.TemporaryDirectory(prefix='gocmd_preflight_') as temp:
        trial_db = Path(temp) / 'trial.db'
        backup(db_path, trial_db)
        subprocess.run([sys.executable, str(ROOT / script), '--db', str(trial_db), '--apply'],
                       check=True, timeout=180)
        trial_counts = verify(trial_db)
        for table, count in original_counts.items():
            if trial_counts.get(table) != count:
                raise RuntimeError(f'Pré-validation : quantité de lignes modifiée dans {table}')
    backup_dir.mkdir(parents=True, exist_ok=True)
    save = backup_dir / f'gocmd_avant_{script.removesuffix(".py")}_{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.db'
    if save.exists():
        raise FileExistsError(save)
    backup(db_path, save)
    try:
        subprocess.run([sys.executable, str(ROOT / script), '--db', str(db_path), '--apply'],
                       check=True, timeout=180)
        after = verify(db_path)
        for table, count in original_counts.items():
            if after.get(table) != count:
                raise RuntimeError(f'ATTENTION : nombre de lignes modifié dans {table}')
    except BaseException:
        print('ÉCHEC : sauvegarde conservée pour restauration manuelle :', save, file=sys.stderr)
        raise
    print('MIGRATION VÉRIFIÉE :', script, '| sauvegarde :', save)
    return save


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db', type=Path, required=True)
    p.add_argument('--backup-dir', type=Path, required=True)
    p.add_argument('--script', required=True)
    p.add_argument('--offline-confirm', default='')
    p.add_argument('--apply', action='store_true')
    a = p.parse_args()
    try:
        perform(a.db, a.backup_dir, a.script, a.offline_confirm, a.apply)
    except Exception as exc:
        p.exit(1, f'ERREUR : {exc}\n')
