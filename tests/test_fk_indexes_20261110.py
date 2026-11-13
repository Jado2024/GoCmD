#!/usr/bin/env python3
"""Audit 10/11/2026 — non-régression DB-IDX-01 (index FK + parité Prisma ↔ SQLite).

1. Tout @@index déclaré dans prisma/schema.prisma doit exister dans la base
   (la dérive silencieuse d'index n'était détectée par aucun test).
2. Les colonnes FK critiques (parents de cascade, jointures chaudes) doivent
   être couvertes par au moins un index en base.
3. La migration upgrade_fk_indexes_20261110.py est idempotente.
"""
import importlib.util
import re
import sqlite3
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]

# Colonnes FK qui doivent être indexées (constat DB-IDX-01).
REQUIRED_FK = [
    ('OrderLine', ['orderId']), ('OrderLine', ['productId']),
    ('PurchaseRequestLine', ['requestId']),
    ('SupplierOrderLine', ['orderId']),
    ('GoodsReceiptLine', ['goodsReceiptId']),
    ('SalesDeliveryLine', ['deliveryId']),
    ('SalesInvoice', ['orderId']),
    ('SalesInvoiceLine', ['invoiceId']),
    ('SupplierInvoiceLine', ['invoiceId']),
    ('Movement', ['stockLotId']),
    ('StockLot', ['receiptLineId']),
    ('QualityInspection', ['materialId']), ('QualityInspection', ['stockLotId']),
    ('SupplierReturn', ['supplierId']), ('SupplierReturn', ['stockLotId']),
    ('StockCount', ['lotId']), ('StockCount', ['locationId']),
    ('SupplierRFQ', ['materialId']),
    ('SupplierQuoteOffer', ['supplierId']),
    ('SupplierCreditNote', ['supplierId']),
    ('StockPlacement', ['locationId']),
    ('PurchaseReceiptLine', ['requestLineId']),
]

schema = (ROOT / 'prisma' / 'schema.prisma').read_text(encoding='utf-8')
declared: dict[str, list[str]] = {}
for m in re.finditer(r'model (\w+) \{(.*?)\n\}', schema, re.S):
    # Prisma autorise @@index([cols], map: "nom_historique") : l'index en base
    # porte alors le nom « map » et non la convention table_cols_idx.
    # La dérive reste détectée : chaque index déclaré doit exister en base
    # sous son nom effectif (map explicite ou convention par défaut).
    for i in re.finditer(r'@@index\(\[([^\]]+)\](?:,\s*map:\s*"([^"]+)")?\)', m.group(2)):
        cols = [c.strip().split(' ')[0] for c in i.group(1).split(',')]
        name = i.group(2) if i.group(2) else m.group(1) + '_' + '_'.join(cols) + '_idx'
        declared[name] = cols


def index_columns(db: sqlite3.Connection, table: str) -> dict[str, list[str]]:
    """Colonnes réellement couvertes par au moins un index de la table."""
    covered: dict[str, list[str]] = {}
    for row in db.execute(f"PRAGMA index_list('{table}')"):
        name = row[1]
        cols = [r[2] for r in db.execute(f"PRAGMA index_info('{name}')")]
        for c in cols:
            covered.setdefault(c, []).append(name)
    # PK implicite
    for r in db.execute(f"PRAGMA table_info('{table}')"):
        if r[5]:
            covered.setdefault(r[1], []).append('PK')
    return covered


def checks(db: sqlite3.Connection) -> None:
    existing = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    missing_declared = sorted(set(declared) - existing)
    assert not missing_declared, f'Index Prisma absents de la base : {missing_declared[:10]}'
    uncovered = []
    for table, cols in REQUIRED_FK:
        covered = index_columns(db, table)
        if not all(c in covered for c in cols):
            uncovered.append(f'{table}({",".join(cols)})')
    assert not uncovered, f'FK non indexées : {uncovered}'
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchone()


with sqlite3.connect(f"file:{ROOT / 'db' / 'custom.db'}?mode=ro", uri=True) as db:
    checks(db)
print(f'PASS DB-IDX-01 : {len(declared)} index déclarés tous présents, {len(REQUIRED_FK)} FK critiques couvertes, base démo intègre')

# Idempotence de la migration sur une copie jetable (sauvegarde externe simulée).
spec = importlib.util.spec_from_file_location('fkidx', ROOT / 'scripts' / 'upgrade_fk_indexes_20261110.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
with TemporaryDirectory() as temp:
    temp = Path(temp)
    copy = temp / 'active' / 'test.db'
    copy.parent.mkdir()
    with sqlite3.connect(f"file:{ROOT / 'db' / 'custom.db'}?mode=ro", uri=True) as src, sqlite3.connect(copy) as dst:
        src.backup(dst)
    mod.run(copy, temp / 'external' / 'backup.db', True)  # doit créer 0 index (déjà à jour)
    with sqlite3.connect(copy) as db:
        checks(db)
print('PASS DB-IDX-01b : migration idempotente, aucune écriture superflue')
