"""P5.13 : migration additive et rejouable. Sauvegarder custom.db AVANT --apply.
Ne jamais modifier les quantités historiques ni le statut des offres existantes.
"""
from pathlib import Path
import argparse, sqlite3
COLUMNS={
 'responseChannel':"TEXT NOT NULL DEFAULT 'written'",
 'confirmationStatus':"TEXT NOT NULL DEFAULT 'confirmed'",
 'contactName':'TEXT',
 'callSummary':'TEXT',
 'respondedAt':'DATETIME'
}
DDL="""CREATE TABLE IF NOT EXISTS "SupplierOfferAttachment" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "offerId" INTEGER NOT NULL,
 "originalName" TEXT NOT NULL,
 "storedName" TEXT NOT NULL,
 "sha256" TEXT NOT NULL,
 "bytes" INTEGER NOT NULL,
 "uploadedBy" TEXT NOT NULL,
 "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("offerId") REFERENCES "SupplierQuoteOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
)"""
INDEX=[
 'CREATE UNIQUE INDEX IF NOT EXISTS "SupplierOfferAttachment_storedName_key" ON "SupplierOfferAttachment"("storedName")',
 'CREATE INDEX IF NOT EXISTS "SupplierOfferAttachment_offerId_uploadedAt_idx" ON "SupplierOfferAttachment"("offerId","uploadedAt")'
]
def upgrade(file:Path):
 db=sqlite3.connect(file,timeout=30)
 try:
  db.execute('PRAGMA foreign_keys=ON')
  tables=['SupplierQuoteOffer','SupplierRFQ','PurchaseRequest','PurchaseRequestLine','SupplierOrder','SupplierOrderLine','SupplierConsultation']
  before={t:db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
  db.execute('BEGIN IMMEDIATE')
  existing={r[1] for r in db.execute('PRAGMA table_info("SupplierQuoteOffer")')}
  for name,ty in COLUMNS.items():
   if name not in existing:db.execute(f'ALTER TABLE "SupplierQuoteOffer" ADD COLUMN "{name}" {ty}')
  db.execute(DDL)
  for sql in INDEX:db.execute(sql)
  after={t:db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
  if before!=after:raise RuntimeError('Données historiques modifiées')
  if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('SQLite integrity check failed')
  db.commit()
  print('P5.13 OK | colonnes offres, documents privés | lignes conservées:',before)
 except Exception:db.rollback();raise
 finally:db.close()
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--db',default='db/custom.db');a.add_argument('--apply',action='store_true');args=a.parse_args()
 file=Path(args.db).resolve()
 if not file.is_file():raise SystemExit('Base introuvable')
 if not args.apply:raise SystemExit('Pas de modification : exiger --apply après sauvegarde')
 upgrade(file)
