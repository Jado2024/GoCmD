"""GoCmd P5.15.18 : migration SQLite additive/idempotente. Jamais de suppression.
Arrêter GoCmd, sauvegarder la base, puis exécuter --apply. La base distribuée de recette
est déjà migrée. Ne pas relancer sur une base en cours d'utilisation.
"""
import argparse
from pathlib import Path
import sqlite3

def upgrade(path:Path):
    if not path.is_file():raise FileNotFoundError(path)
    con=sqlite3.connect(str(path),timeout=30)
    try:
        con.execute('PRAGMA foreign_keys=ON')
        con.execute('BEGIN IMMEDIATE')
        def column(table,name,sql):
            if name not in {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}:
                con.execute(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {sql}')
        column('SupplierQuoteOffer','revisionNo','INTEGER NOT NULL DEFAULT 1')
        column('SupplierOfferAttachment','revisionNo','INTEGER NOT NULL DEFAULT 1')
        for name,sql in {'responseStatus':"TEXT NOT NULL DEFAULT 'invited'",'contactAt':'DATETIME','lastReminderAt':'DATETIME','reminderCount':'INTEGER NOT NULL DEFAULT 0','declineReason':'TEXT'}.items():
            column('SupplierConsultationRecipientLine',name,sql)
        statements='''
        CREATE TABLE IF NOT EXISTS "SupplierAwardPlan" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,"rfqId" INTEGER NOT NULL,"status" TEXT NOT NULL DEFAULT 'pending',"reason" TEXT NOT NULL,"proposedBy" TEXT NOT NULL,"proposedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"decidedBy" TEXT,"decidedAt" DATETIME,"decisionNote" TEXT,FOREIGN KEY("rfqId") REFERENCES "SupplierRFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
        CREATE TABLE IF NOT EXISTS "SupplierAwardAllocation" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,"planId" INTEGER NOT NULL,"offerId" INTEGER NOT NULL,"qty" REAL NOT NULL,"unitPrice" DECIMAL NOT NULL,FOREIGN KEY("planId") REFERENCES "SupplierAwardPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,FOREIGN KEY("offerId") REFERENCES "SupplierQuoteOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
        CREATE TABLE IF NOT EXISTS "SupplierQuoteRevision" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,"offerId" INTEGER NOT NULL,"version" INTEGER NOT NULL,"previousSnapshot" TEXT NOT NULL,"reason" TEXT NOT NULL,"revisedBy" TEXT NOT NULL,"revisedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY("offerId") REFERENCES "SupplierQuoteOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
        CREATE INDEX IF NOT EXISTS "SupplierAwardPlan_rfqId_status_idx" ON "SupplierAwardPlan"("rfqId","status");
        CREATE UNIQUE INDEX IF NOT EXISTS "SupplierAwardAllocation_planId_offerId_key" ON "SupplierAwardAllocation"("planId","offerId");
        CREATE INDEX IF NOT EXISTS "SupplierAwardAllocation_offerId_idx" ON "SupplierAwardAllocation"("offerId");
        CREATE UNIQUE INDEX IF NOT EXISTS "SupplierQuoteRevision_offerId_version_key" ON "SupplierQuoteRevision"("offerId","version");
        '''
        for stmt in statements.split(';'):
            if stmt.strip():con.execute(stmt)
        # Atomic transaction, including DDL.
        assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert not con.execute('PRAGMA foreign_key_check').fetchall()
        con.commit()
        print('Migration additive P5.15.18 OK:',path)
    except Exception:
        con.rollback();raise
    finally:con.close()

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--db',default='db/custom.db');ap.add_argument('--apply',action='store_true')
    args=ap.parse_args()
    if not args.apply:raise SystemExit('Lecture seule : sauvegarder la BDD et fournir --apply')
    upgrade(Path(args.db).resolve())
