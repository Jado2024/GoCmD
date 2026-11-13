"""P5.12: migration SQLite additive et rejouable. Ne modifie ni DA, ni BC, ni fournisseurs."""
from pathlib import Path
import sqlite3, argparse

TABLES = [
'''CREATE TABLE IF NOT EXISTS "SupplierConsultation" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "ref" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'prepared',
 "createdBy" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "deadline" DATETIME
)''',
'''CREATE TABLE IF NOT EXISTS "SupplierConsultationLine" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "consultationId" INTEGER NOT NULL,
 "rfqId" INTEGER NOT NULL,
 FOREIGN KEY("consultationId") REFERENCES "SupplierConsultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("rfqId") REFERENCES "SupplierRFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE
)''',
'''CREATE TABLE IF NOT EXISTS "SupplierConsultationRecipient" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "consultationId" INTEGER NOT NULL,
 "supplierId" INTEGER NOT NULL,
 FOREIGN KEY("consultationId") REFERENCES "SupplierConsultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE
)''',
'''CREATE TABLE IF NOT EXISTS "SupplierConsultationRecipientLine" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "recipientId" INTEGER NOT NULL,
 "rfqId" INTEGER NOT NULL,
 FOREIGN KEY("recipientId") REFERENCES "SupplierConsultationRecipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("rfqId") REFERENCES "SupplierRFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE
)''',
]
INDEXES = [
'CREATE UNIQUE INDEX IF NOT EXISTS "SupplierConsultation_ref_key" ON "SupplierConsultation"("ref")',
'CREATE INDEX IF NOT EXISTS "SupplierConsultation_createdAt_idx" ON "SupplierConsultation"("createdAt")',
'CREATE UNIQUE INDEX IF NOT EXISTS "SupplierConsultationLine_rfqId_key" ON "SupplierConsultationLine"("rfqId")',
'CREATE INDEX IF NOT EXISTS "SupplierConsultationLine_consultationId_idx" ON "SupplierConsultationLine"("consultationId")',
'CREATE UNIQUE INDEX IF NOT EXISTS "SupplierConsultationRecipient_consultationId_supplierId_key" ON "SupplierConsultationRecipient"("consultationId","supplierId")',
'CREATE UNIQUE INDEX IF NOT EXISTS "SupplierConsultationRecipientLine_recipientId_rfqId_key" ON "SupplierConsultationRecipientLine"("recipientId","rfqId")',
'CREATE INDEX IF NOT EXISTS "SupplierConsultationRecipientLine_rfqId_idx" ON "SupplierConsultationRecipientLine"("rfqId")',
]
def upgrade(path:Path):
    c=sqlite3.connect(path,timeout=30)
    try:
        c.execute('PRAGMA foreign_keys=ON')
        mandatory=('Supplier','Material','SupplierRFQ','PurchaseRequestLine','AuditEvent')
        for t in mandatory:
            if not c.execute('SELECT 1 FROM sqlite_master WHERE type="table" AND name=?',(t,)).fetchone():
                raise RuntimeError('Table requise absente : '+t)
        before={t:c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in mandatory}
        c.execute('BEGIN IMMEDIATE')
        for sql in TABLES+INDEXES:c.execute(sql)
        after={t:c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in mandatory}
        if before!=after:raise RuntimeError('Données antérieures modifiées')
        fk=c.execute('PRAGMA foreign_key_check').fetchall()
        if fk:raise RuntimeError(f'Violations FK : {fk[:3]}')
        if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Intégrité SQLite incorrecte')
        c.commit()
        print('P5.12 OK | tables consultations | historique conservé :',before,'| intégrité ok')
    except Exception:c.rollback();raise
    finally:c.close()
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--db',default='db/custom.db');a.add_argument('--apply',action='store_true');v=a.parse_args()
    path=Path(v.db).resolve()
    if not path.is_file():raise SystemExit('Base absente: '+str(path))
    if not v.apply:raise SystemExit('Aucune modification : utiliser --apply après sauvegarde.')
    upgrade(path)
