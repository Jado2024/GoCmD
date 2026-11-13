#!/usr/bin/env python3
"""Protect immutable SODEPI documents against physical DELETE, including cascades.

Opt-in additive SQLite migration. Run with GoCmd stopped and an external backup:
  python scripts/upgrade_history_delete_guards_p51523.py --db path/to/PRODUCTION.db \
      --backup /another/directory/before_history_guards.db --apply

The normal ERP workflow uses status/cancellation/credit notes, not hard deletes.
This migration is intentionally NOT applied automatically to the reusable demo DB,
whose explicitly authorized reset utilities must continue to work.
"""
import argparse
from pathlib import Path
import sqlite3

IMMUTABLE_TABLES = (
    'Order', 'OrderLine', 'OrderPiece', 'PurchaseRequest', 'PurchaseRequestLine',
    'PurchaseReceipt', 'PurchaseReceiptLine', 'SupplierOrder', 'SupplierOrderLine',
    'GoodsReceipt', 'GoodsReceiptLine', 'SupplierInvoice', 'SupplierInvoiceLine',
    'SalesDelivery', 'SalesDeliveryLine', 'SalesInvoice', 'SalesInvoiceLine',
    'Movement', 'StockLot',
    # Audit 10/11/2026 (DB-HIST-02, P1) : Movement.materialId est ON DELETE
    # SET NULL dans le DDL réel — sans garde, un DELETE SQL direct d'une
    # matière détachait silencieusement l'historique des mouvements.
    'Material',
)


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
    missing = set(IMMUTABLE_TABLES) - tables
    if missing:
        raise RuntimeError(f'Schéma incompatible : tables absentes {sorted(missing)}')
    if not apply:
        print('PREVIEW OK — tables protégées:', len(IMMUTABLE_TABLES), '(ajouter --apply + --backup externe)')
        return
    if backup_path is None:
        raise ValueError('Sauvegarde externe obligatoire : --backup')
    backup_path = backup_path.expanduser().resolve()
    if backup_path == db_path or backup_path.exists() or (backup_path.parent == db_path.parent or backup_path.parent.is_relative_to(db_path.parent)):
        raise ValueError('Sauvegarde distincte, nouvelle et dans un dossier externe obligatoire')
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with sqlite3.connect(f'file:{db_path}?mode=ro', uri=True) as src, sqlite3.connect(backup_path) as dst:
            src.backup(dst)
            verify(dst)
        with sqlite3.connect(str(db_path), timeout=30) as db:
            db.execute('PRAGMA busy_timeout=30000')
            verify(db)
            try:
                db.execute('BEGIN IMMEDIATE')
                for table in IMMUTABLE_TABLES:
                    name = 'gocmd_no_hard_delete_' + table.lower()
                    db.execute(f'''CREATE TRIGGER IF NOT EXISTS "{name}"
                        BEFORE DELETE ON "{table}" BEGIN
                        SELECT RAISE(ABORT, 'GOCMD_HISTORICAL_DELETE_FORBIDDEN');
                        END''')
                verify(db)
                db.execute('COMMIT')
            except BaseException:
                db.execute('ROLLBACK')
                raise
        print('PROTECTION OK:', len(IMMUTABLE_TABLES), 'tables ; sauvegarde :', backup_path)
    except BaseException:
        # Keep any complete backup for manual recovery; never silently overwrite production.
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True, type=Path)
    parser.add_argument('--backup', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    run(args.db, args.backup, args.apply)
