#!/usr/bin/env python3
"""Lock monetary and identifying fields of issued customer / approved supplier invoices.

Run with GoCmd stopped. An external verified SQLite backup is mandatory.
This is additive and idempotent; status, payment and credit-note operations stay writable.

  python scripts/upgrade_invoice_immutability_p51523.py --db /data/gocmd.db \
      --backup /backups/before_invoice_immutability.db --apply
"""
import argparse
from pathlib import Path
import sqlite3

GUARDS = {
    'SalesInvoice': ('ref','orderId','clientId','currency','taxRateBps',
        'subtotalCents','taxCents','totalCents','createdBy','issuedAt','clientNameSnapshot'),
    'SupplierInvoice': ('supplierId','invoiceNumber','invoiceDate','currency',
        'totalAmount','freightAmount','createdBy','replacesInvoiceId'),
}
LINE_GUARDS = {
    'SalesInvoiceLine': ('invoiceId','deliveryLineId','qty','unit','unitPriceCents',
        'amountCents','productNameSnapshot','productSkuSnapshot'),
    'SupplierInvoiceLine': ('invoiceId','orderLineId','receiptLineId','qty','unitPrice','taxRate'),
}


def check(db: sqlite3.Connection):
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise RuntimeError('SQLite integrity check failed')
    if db.execute('PRAGMA foreign_key_check').fetchone():
        raise RuntimeError('SQLite foreign-key check failed')


def install(db: sqlite3.Connection):
    # Invoice headers are inserted with their lines in the same Prisma transaction.
    # UPDATE locks don't obstruct initial creation or subsequent status/version changes.
    for table, fields in GUARDS.items():
        columns={r[1] for r in db.execute(f'PRAGMA table_info("{table}")')}
        if not set(fields).issubset(columns):
            raise RuntimeError(f'Invoice schema mismatch on {table}')
        predicate=' OR '.join(f'OLD."{field}" IS NOT NEW."{field}"' for field in fields)
        state = '1' if table == 'SalesInvoice' else "OLD.status IN ('matched','blocked','approved','paid','rejected')"
        db.execute(f'''CREATE TRIGGER IF NOT EXISTS "gocmd_invoice_lock_{table.lower()}"
          BEFORE UPDATE ON "{table}"
          WHEN ({state}) AND ({predicate})
          BEGIN SELECT RAISE(ABORT, 'GOCMD_INVOICE_IMMUTABLE'); END''')
    for table, fields in LINE_GUARDS.items():
        columns={r[1] for r in db.execute(f'PRAGMA table_info("{table}")')}
        if not set(fields).issubset(columns):
            raise RuntimeError(f'Invoice line schema mismatch on {table}')
        parent = 'SalesInvoice' if table == 'SalesInvoiceLine' else 'SupplierInvoice'
        state = "1" if table=='SalesInvoiceLine' else "parent.status IN ('matched','blocked','approved','paid','rejected')"
        predicate=' OR '.join(f'OLD."{field}" IS NOT NEW."{field}"' for field in fields)
        db.execute(f'''CREATE TRIGGER IF NOT EXISTS "gocmd_invoice_lock_{table.lower()}"
          BEFORE UPDATE ON "{table}"
          WHEN EXISTS(SELECT 1 FROM "{parent}" parent WHERE parent.id=OLD.invoiceId AND {state})
               AND ({predicate})
          BEGIN SELECT RAISE(ABORT, 'GOCMD_INVOICE_LINE_IMMUTABLE'); END''')
        db.execute(f'''CREATE TRIGGER IF NOT EXISTS "gocmd_invoice_lock_delete_{table.lower()}"
          BEFORE DELETE ON "{table}"
          WHEN EXISTS(SELECT 1 FROM "{parent}" parent WHERE parent.id=OLD.invoiceId AND {state})
          BEGIN SELECT RAISE(ABORT, 'GOCMD_INVOICE_LINE_IMMUTABLE'); END''')


def run(db_path: Path, backup_path: Path | None, apply: bool):
    db_path=db_path.expanduser().resolve()
    if not db_path.is_file():
        raise FileNotFoundError(f'Database not found: {db_path}')
    with sqlite3.connect(f'file:{db_path}?mode=ro',uri=True) as source:
        check(source)
        for table in [*GUARDS,*LINE_GUARDS]:
            if not source.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                raise RuntimeError(f'Missing table: {table}')
    if not apply:
        print('PREVIEW PASS: 4 invoice tables ready; use --apply and --backup to install')
        return
    if backup_path is None:
        raise ValueError('External backup required')
    backup_path=backup_path.expanduser().resolve()
    if backup_path == db_path or backup_path.exists() or backup_path.parent == db_path.parent or backup_path.parent.is_relative_to(db_path.parent):
        raise ValueError('Backup must be a new file in a separate directory')
    backup_path.parent.mkdir(parents=True,exist_ok=True)
    with sqlite3.connect(f'file:{db_path}?mode=ro',uri=True) as source, sqlite3.connect(backup_path) as backup:
        source.backup(backup)
        check(backup)
    with sqlite3.connect(db_path,timeout=30) as db:
        db.execute('PRAGMA busy_timeout=30000')
        check(db)
        try:
            db.execute('BEGIN IMMEDIATE')
            install(db)
            check(db)
            db.commit()
        except BaseException:
            db.rollback()
            raise
    print('PASS: invoice field locks installed, validated backup:', backup_path)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db',type=Path,required=True)
    p.add_argument('--backup',type=Path)
    p.add_argument('--apply',action='store_true')
    a=p.parse_args()
    run(a.db,a.backup,a.apply)
