#!/usr/bin/env python3
"""Migration additive idempotente; backup avant mutation; transaction unique."""
import argparse, sqlite3, shutil, datetime, pathlib, os
p=argparse.ArgumentParser()
p.add_argument('--db',default='db/custom.db')
p.add_argument('--apply',action='store_true')
a=p.parse_args()
f=pathlib.Path(a.db).resolve()
if not a.apply: raise SystemExit('DRY RUN — utiliser --apply seulement sur une copie de demo ou backup valide')
if not f.is_file(): raise SystemExit('Base inexistante')
backup=f.with_name(f.name+'.bak-replenishment-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f'))
with sqlite3.connect(f) as src, sqlite3.connect(backup) as dest:src.backup(dest)
with sqlite3.connect(f,timeout=30) as c:
 c.execute('PRAGMA foreign_keys=ON'); c.execute('BEGIN IMMEDIATE')
 try:
  def add(table,col,ddl):
   if col not in {x[1] for x in c.execute(f'PRAGMA table_info("{table}")')}:
    c.execute(f'ALTER TABLE "{table}" ADD COLUMN "{col}" {ddl}')
  add('Material','targetStock','REAL')
  add('Material','pendingSalesUnitPrice','REAL')
  add('Material','salesPriceProposedBy','TEXT')
  add('Material','salesPriceProposalReason','TEXT')
  add('Material','salesPriceProposedAt','DATETIME')
  add('Material','salesPriceProposalRevision','INTEGER NOT NULL DEFAULT 0')
  add('Product','minStock','REAL NOT NULL DEFAULT 0')
  add('Product','targetStock','REAL')
  add('Product','pendingCatalogUnitPrice','REAL')
  add('Product','catalogPriceProposedBy','TEXT')
  add('Product','catalogPriceProposalReason','TEXT')
  add('Product','catalogPriceProposedAt','DATETIME')
  add('Product','catalogPriceProposalRevision','INTEGER NOT NULL DEFAULT 0')
  add('FinishedStockLot','workOrderId','INTEGER REFERENCES "WorkOrder"("id") ON DELETE RESTRICT')
  c.execute('CREATE INDEX IF NOT EXISTS "FinishedStockLot_workOrderId_idx" ON "FinishedStockLot"("workOrderId")')
  c.execute('''CREATE TABLE IF NOT EXISTS "ProductionReplenishmentRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "ref" TEXT NOT NULL UNIQUE,
    "productId" INTEGER REFERENCES "Product"("id") ON DELETE RESTRICT,
    "materialId" INTEGER REFERENCES "Material"("id") ON DELETE RESTRICT,
    "qty" REAL NOT NULL CHECK("qty">0), "unit" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed', "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT, "decidedAt" DATETIME, "decisionReason" TEXT,
    CHECK(("productId" IS NOT NULL) != ("materialId" IS NOT NULL)))''')
  c.execute('CREATE INDEX IF NOT EXISTS "ProductionReplenishmentRequest_productId_status_idx" ON "ProductionReplenishmentRequest"("productId","status")')
  c.execute('CREATE INDEX IF NOT EXISTS "ProductionReplenishmentRequest_materialId_status_idx" ON "ProductionReplenishmentRequest"("materialId","status")')
  c.execute('''CREATE TRIGGER IF NOT EXISTS "gocmd_protect_production_request_delete" BEFORE DELETE ON "ProductionReplenishmentRequest" BEGIN SELECT RAISE(ABORT,'GOCMD_PRODUCTION_REQUEST_DELETE_FORBIDDEN'); END''')
  fk=c.execute('PRAGMA foreign_key_check').fetchall()
  if fk:raise RuntimeError(f'Foreign key errors: {fk[:3]}')
  c.commit()
 except:
  c.rollback();raise
 print('PASS migration; backup:', backup)
