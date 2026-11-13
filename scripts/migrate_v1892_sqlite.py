#!/usr/bin/env python3
"""GoCmd V18.9.2 SQLite migration (contre-audit indépendant F02/F05/F06).
Requires explicit acknowledgment and a backup. Preserves all rows and
references; migration is idempotent. Operates only on an explicit path.
Use an isolated copy before applying it to any business database.

Adds:
  SupplierCreditNote.kind, SupplierCreditNote.version   (F02/F05)
  SupplierInvoice.replacesInvoiceId                     (F06)
  SupplierReturnCreditAllocation table                  (F05)
  SupplierRefund table                                  (F02)
"""
import argparse, sqlite3, hashlib, shutil, pathlib

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def fields(db, table): return {r[1] for r in db.execute(f'PRAGMA table_info("{table}")')}
def tables(db): return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}

def apply(path):
    before=sha(path)
    backup=path.with_name(path.name+'.before_v1892.bak')
    if not backup.exists(): shutil.copy2(path,backup)
    else:
        # Avoid accidentally overwriting a genuine prior pre-migration snapshot.
        print('Existing backup retained:',backup)
    db=sqlite3.connect(str(path))
    db.execute('PRAGMA busy_timeout=30000')
    db.execute('PRAGMA foreign_keys=OFF')
    db.execute('BEGIN IMMEDIATE')
    try:
        # ── F02/F05 : SupplierCreditNote kind + version ─────────────────────
        if 'kind' not in fields(db,'SupplierCreditNote'):
            db.execute("ALTER TABLE SupplierCreditNote ADD COLUMN kind TEXT NOT NULL DEFAULT 'balance'")
            print('SupplierCreditNote.kind added')
        if 'version' not in fields(db,'SupplierCreditNote'):
            db.execute('ALTER TABLE SupplierCreditNote ADD COLUMN version INTEGER NOT NULL DEFAULT 0')
            print('SupplierCreditNote.version added')
        db.execute('CREATE INDEX IF NOT EXISTS SupplierCreditNote_kind_status_idx ON SupplierCreditNote(kind,status)')

        # ── F06 : SupplierInvoice.replacesInvoiceId ─────────────────────────
        if 'replacesInvoiceId' not in fields(db,'SupplierInvoice'):
            db.execute('ALTER TABLE SupplierInvoice ADD COLUMN replacesInvoiceId INTEGER REFERENCES SupplierInvoice(id)')
            print('SupplierInvoice.replacesInvoiceId added')

        # ── F05 : SupplierReturnCreditAllocation ────────────────────────────
        if 'SupplierReturnCreditAllocation' not in tables(db):
            db.execute('''CREATE TABLE SupplierReturnCreditAllocation (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             returnId INTEGER NOT NULL REFERENCES SupplierReturn(id),
             creditId INTEGER NOT NULL REFERENCES SupplierCreditNote(id),
             amountCents INTEGER NOT NULL,
             createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
             CONSTRAINT SupplierReturnCreditAllocation_returnId_creditId_key UNIQUE (returnId,creditId),
             CHECK (amountCents > 0))''')
            print('SupplierReturnCreditAllocation created')
        db.execute('CREATE INDEX IF NOT EXISTS SupplierReturnCreditAllocation_creditId_idx ON SupplierReturnCreditAllocation(creditId)')

        # ── F02 : SupplierRefund ────────────────────────────────────────────
        if 'SupplierRefund' not in tables(db):
            db.execute('''CREATE TABLE SupplierRefund (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             creditNoteId INTEGER NOT NULL UNIQUE REFERENCES SupplierCreditNote(id),
             supplierId INTEGER NOT NULL REFERENCES Supplier(id),
             amount DECIMAL NOT NULL,
             status TEXT NOT NULL DEFAULT 'pending',
             method TEXT,
             reference TEXT,
             actor TEXT NOT NULL,
             refundedAt DATETIME,
             refundActor TEXT,
             createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
             CHECK (status IN ('pending','refunded')))''')
            print('SupplierRefund created')
        db.execute('CREATE INDEX IF NOT EXISTS SupplierRefund_supplierId_status_idx ON SupplierRefund(supplierId,status)')

        db.execute('COMMIT')
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    except Exception:
        db.execute('ROLLBACK')
        raise
    finally:
        db.close()
    after=sha(path)
    print('integrity_check ok, foreign_key_check clean')
    print('before sha256:',before)
    print('after  sha256:',after)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='GoCmd V18.9.2 SQLite migration (F02/F05/F06)')
    parser.add_argument('--path',required=True,help='explicit path to the SQLite database file')
    parser.add_argument('--ack',required=True,help='required acknowledgment: DEMO_ONLY')
    args=parser.parse_args()
    if args.ack!='DEMO_ONLY':
        raise SystemExit('REFUSED: --ack DEMO_ONLY required (run on an isolated copy first)')
    target=pathlib.Path(args.path)
    if not target.is_file(): raise SystemExit(f'Not a file: {target}')
    apply(target)
