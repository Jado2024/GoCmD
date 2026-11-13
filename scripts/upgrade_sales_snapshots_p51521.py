#!/usr/bin/env python3
"""VEN-02: ajout non destructif des photographies commerciales. Dry-run par défaut.

Anciennes lignes: NULL = document historique non figé; la valeur originale n'est
pas reconstructible après changement de catalogue. Aucun backfill supposé exact.
"""
import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

COLUMNS = {
    'OrderLine': [('productNameSnapshot', 'TEXT'), ('productSkuSnapshot', 'TEXT')],
    'SalesQuote': [('clientNameSnapshot', 'TEXT'), ('productsSnapshotJson', 'TEXT')],
    'SalesDelivery': [('clientNameSnapshot', 'TEXT')],
    'SalesDeliveryLine': [('productNameSnapshot', 'TEXT'), ('productSkuSnapshot', 'TEXT')],
    'SalesInvoice': [('clientNameSnapshot', 'TEXT')],
    'SalesInvoiceLine': [('productNameSnapshot', 'TEXT'), ('productSkuSnapshot', 'TEXT')],
}

def run(path: Path, apply: bool = False) -> list[tuple[str, str]]:
    if not path.is_file():
        raise ValueError(f'Base absente: {path}')
    with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as con:
        if con.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Intégrité de la base invalide')
        if con.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Clés étrangères invalides avant migration')
        additions = []
        for table, names in COLUMNS.items():
            if not con.execute('SELECT 1 FROM sqlite_master WHERE type="table" AND name=?', (table,)).fetchone():
                raise ValueError(f'Table requise absente: {table}')
            existing = {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}
            additions.extend((table, field) for field, kind in names if field not in existing)
    print(f'{len(additions)} colonnes manquantes (mode {"APPLY" if apply else "PREVIEW"})')
    if not apply or not additions:
        return additions
    backup = path.with_name(path.stem + '.avant_snapshots_ventes_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.db')
    with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as src, sqlite3.connect(backup) as dest:
        src.backup(dest)
    with sqlite3.connect(path) as con:
        con.execute('PRAGMA foreign_keys=ON')
        con.execute('BEGIN IMMEDIATE')
        for table, field in additions:
            con.execute(f'ALTER TABLE "{table}" ADD COLUMN "{field}" TEXT')
        assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not con.execute('PRAGMA foreign_key_check').fetchall()
        con.commit()
    print('Migration OK ; sauvegarde :', backup)
    return additions

if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('--db', required=True, type=Path)
    a.add_argument('--apply', action='store_true')
    opts = a.parse_args()
    run(opts.db, opts.apply)
