#!/usr/bin/env python3
"""Indexation des clés étrangères + réconciliation Prisma ↔ SQLite (audit 10/11/2026).

Gravité P2 (DB-IDX-01) :
  1. SQLite n'indexe JAMAIS automatiquement les colonnes des clés étrangères :
     18+ FK critiques (dont les 4 parents de cascade OrderLine, PurchaseRequestLine,
     SupplierOrderLine, GoodsReceiptLine) obligeaient chaque jointure et chaque
     contrôle FK RESTRICT/CASCADE à un SCAN COMPLET de table — significatif dès
     les volumétries de campagne annoncées (100 → 100 000 documents).
  2. 15 index déclarés dans prisma/schema.prisma étaient ABSENTS de la base
     réelle (dérive silencieuse : le test de contrat ne vérifiait que les champs
     scalaires).

Migration ADDITIVE et idempotente : CREATE INDEX IF NOT EXISTS uniquement,
aucune donnée touchée, noms exacts de la convention Prisma (Model_colonnes_idx)
pour que schéma et base soient enfin réconciliés dans les DEUX sens.

Usage :
  python scripts/upgrade_fk_indexes_20261110.py --db PRODUCTION.db \
      --backup /autre/dossier/before_fk_indexes.db --apply
"""
import argparse
from pathlib import Path
import sqlite3

# (table, colonnes, nom d'index conforme à la convention Prisma)
def idx(table: str, *cols: str) -> tuple[str, tuple[str, ...], str]:
    return table, cols, f"{table}_{'_'.join(cols)}_idx"

INDEXES: list[tuple[str, tuple[str, ...], str]] = [
    # — FK critiques non indexées par SQLite (jointures, cascades, RESTRICT) —
    idx('OrderLine', 'orderId'), idx('OrderLine', 'productId'),
    idx('PurchaseRequestLine', 'requestId'),
    idx('SupplierOrderLine', 'orderId'),
    idx('GoodsReceiptLine', 'goodsReceiptId'),
    idx('SalesDeliveryLine', 'deliveryId'),
    idx('SalesInvoice', 'orderId'),
    idx('SalesInvoiceLine', 'invoiceId'),
    idx('SupplierInvoiceLine', 'invoiceId'),
    idx('Movement', 'stockLotId'),
    idx('StockLot', 'receiptLineId'),
    idx('QualityInspection', 'materialId'), idx('QualityInspection', 'stockLotId'),
    idx('SupplierReturn', 'supplierId'), idx('SupplierReturn', 'stockLotId'),
    idx('StockCount', 'lotId'), idx('StockCount', 'locationId'),
    idx('SupplierRFQ', 'materialId'),
    idx('SupplierQuoteOffer', 'supplierId'),
    idx('SupplierCreditNote', 'supplierId'),
    idx('StockPlacement', 'locationId'),
    idx('PurchaseReceiptLine', 'requestLineId'),
    # — Dérive Prisma ↔ base : index déclarés mais jamais créés —
    idx('Product', 'family', 'coreType', 'foamComposition'),
    idx('Product', 'family', 'foamNature', 'foamDensity'),
    idx('PurchaseRequest', 'status', 'createdAt', 'id'),
    idx('PurchaseRequest', 'createdAt', 'id'),
    idx('StockLot', 'materialId', 'status'),
    idx('AuditEvent', 'entity', 'entityId', 'id'),
    idx('SupplierQualification', 'supplierId', 'reviewedAt'),
    idx('SupplierRFQ', 'status', 'deadline'),
    idx('SupplierRFQ', 'createdAt', 'id'),
    idx('SupplierConsultation', 'createdAt', 'id'),
    idx('SupplierAwardContractAllocation', 'agreementId'),
    idx('SupplierDispute', 'supplierId', 'status'),
    idx('SupplierDeliverySchedule', 'orderId', 'targetDate'),
    idx('StockCount', 'status', 'countedAt'),
    idx('StockCount', 'countedAt', 'id'),
]


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
        existing = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    targets = [t for t in INDEXES if t[0] in tables and t[2] not in existing]
    if not targets:
        print('DÉJÀ À JOUR : tous les index FK et déclarés sont présents')
        return
    if not apply:
        print(f'PREVIEW OK — {len(targets)} index à créer (ajouter --apply + --backup externe)')
        for table, cols, name in targets: print('  ', name)
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
    with sqlite3.connect(str(db_path), timeout=60) as db:
        db.execute('PRAGMA busy_timeout=60000')
        verify(db)
        try:
            db.execute('BEGIN IMMEDIATE')
            for table, cols, name in targets:
                db.execute(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}"({", ".join(cols)})')
            verify(db)
            db.execute('COMMIT')
        except BaseException:
            db.execute('ROLLBACK')
            raise
    with sqlite3.connect(f'file:{db_path}?mode=ro', uri=True) as check:
        missing = [name for _, _, name in targets
                   if not check.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?", (name,)).fetchone()]
        if missing:
            raise RuntimeError(f'Index non créés après commit : {missing}')
    print(f'PASS — {len(targets)} index créés ; sauvegarde : {backup_path}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True, type=Path)
    parser.add_argument('--backup', type=Path,
                        help="Chemin de sauvegarde externe, ou 'auto' pour un fichier horodate dans <projet>/backups/")
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    # AUDIT P5.15.27-A : l'alias npm db:upgrade:fk-indexes echouait faute de
    # --backup fourni. 'auto' genere une sauvegarde externe horodatee (jamais
    # dans db/), preservant l'exigence de securite pour les executions repetees.
    backup_arg: Path | None = args.backup
    if backup_arg is not None and str(backup_arg) == 'auto':
        from datetime import datetime
        backup_arg = (Path(__file__).resolve().parents[1] / 'backups'
                      / f'fk_indexes_{datetime.now().strftime("%Y%m%d_%H%M%S")}.db')
    run(args.db, backup_arg, args.apply)
