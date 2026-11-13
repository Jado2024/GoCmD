#!/usr/bin/env python3
"""GoCmd V18.6 SQLite migration. Requires explicit acknowledgment and a backup.
Preserves all rows and references; migration is idempotent. Operates only on an explicit path.
Use an isolated copy before applying it to any business database.
"""
import argparse, sqlite3, hashlib, shutil, pathlib

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def fields(db, table): return {r[1] for r in db.execute(f'PRAGMA table_info("{table}")')}

def apply(path):
    before=sha(path)
    backup=path.with_name(path.name+'.before_v186.bak')
    if not backup.exists(): shutil.copy2(path,backup)
    else:
        # Avoid accidentally overwriting a genuine prior pre-migration snapshot.
        print('Existing backup retained:',backup)
    db=sqlite3.connect(str(path))
    db.execute('PRAGMA busy_timeout=30000')
    db.execute('PRAGMA foreign_keys=OFF')
    db.execute('BEGIN IMMEDIATE')
    try:
        if 'version' not in fields(db,'SupplierInvoice'):
            db.execute('ALTER TABLE SupplierInvoice ADD COLUMN version INTEGER NOT NULL DEFAULT 0')
        if 'version' not in fields(db,'SalesInvoice'):
            db.execute('ALTER TABLE SalesInvoice ADD COLUMN version INTEGER NOT NULL DEFAULT 0')
        if 'decisionActor' not in fields(db,'SupplierCreditNote'):
            old=db.execute('SELECT COUNT(*) FROM SupplierCreditNote').fetchone()[0]
            db.execute('''CREATE TABLE SupplierCreditNote_V186 (
             id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE,
             supplierId INTEGER NOT NULL REFERENCES Supplier(id),
             invoiceId INTEGER NOT NULL REFERENCES SupplierInvoice(id),
             returnId INTEGER,amount DECIMAL NOT NULL,reason TEXT NOT NULL,
             status TEXT NOT NULL DEFAULT 'draft',actor TEXT NOT NULL,
             decisionActor TEXT,decisionReason TEXT,decidedAt DATETIME,
             createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)''')
            db.execute('''INSERT INTO SupplierCreditNote_V186
              (id,ref,supplierId,invoiceId,returnId,amount,reason,status,actor,createdAt)
              SELECT id,ref,supplierId,invoiceId,returnId,amount,reason,status,actor,createdAt
              FROM SupplierCreditNote''')
            db.execute('DROP TABLE SupplierCreditNote')
            db.execute('ALTER TABLE SupplierCreditNote_V186 RENAME TO SupplierCreditNote')
            db.execute('CREATE INDEX IF NOT EXISTS SupplierCreditNote_invoiceId_idx ON SupplierCreditNote(invoiceId)')
            assert db.execute('SELECT COUNT(*) FROM SupplierCreditNote').fetchone()[0]==old
        if 'status' not in fields(db,'SalesCreditNote'):
            db.execute("ALTER TABLE SalesCreditNote ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'")
            # Credits predating V18.6 were effective immediately; preserve their accounting effect.
            db.execute("UPDATE SalesCreditNote SET status='approved'")
        for column,ddl in (
            ('decisionActor','TEXT'),('decisionReason','TEXT'),('decidedAt','DATETIME')):
            if column not in fields(db,'SalesCreditNote'):
                db.execute(f'ALTER TABLE SalesCreditNote ADD COLUMN {column} {ddl}')
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        db.commit()
    except:
        db.rollback();raise
    finally: db.execute('PRAGMA foreign_keys=ON');db.close()
    print('Migrated',path,'original',before,'new',sha(path),'backup',backup)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db',type=pathlib.Path,required=True)
    p.add_argument('--apply',action='store_true')
    p.add_argument('--ack',choices=['SCHEMA_V186_BACKUP_VERIFIED'],required=True)
    a=p.parse_args()
    if not a.apply: p.error('explicit --apply required')
    if not a.db.is_file(): p.error('DB not found')
    apply(a.db)
