#!/usr/bin/env python3
"""P5.15.26 - migration additive MTS, TOUJOURS sur copie de recette ou backup vérifié.
Exécuter APRÈS upgrade_replenishment_p51525.py. Idempotent.
"""
import argparse,datetime,pathlib,sqlite3
p=argparse.ArgumentParser();p.add_argument('--db',default='db/custom.db');p.add_argument('--apply',action='store_true');a=p.parse_args()
if not a.apply:raise SystemExit('DRY RUN : ajouter --apply après sauvegarde et test de restauration')
f=pathlib.Path(a.db).resolve()
if not f.is_file():raise SystemExit('Base inexistante')
backup=f.with_name(f.name+'.bak-mts-p51526-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f'))
with sqlite3.connect(f) as src,sqlite3.connect(backup) as dest:src.backup(dest)
with sqlite3.connect(f,timeout=45) as c:
 c.execute('PRAGMA foreign_keys=ON');c.execute('BEGIN IMMEDIATE')
 try:
  c.execute('''CREATE TABLE IF NOT EXISTS "ProductionStockOrder" (
   "id" INTEGER PRIMARY KEY AUTOINCREMENT,"ref" TEXT NOT NULL UNIQUE,
   "requestId" INTEGER NOT NULL UNIQUE REFERENCES "ProductionReplenishmentRequest"("id") ON DELETE RESTRICT,
   "status" TEXT NOT NULL DEFAULT 'approved' CHECK("status" IN ('approved','planned','in_progress','completed','closed','cancelled')),
   "createdBy" TEXT NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   "plannedStartAt" DATETIME,"dueAt" DATETIME,"plannedBy" TEXT,
   "startedBy" TEXT,"startedAt" DATETIME,"completedBy" TEXT,"completedAt" DATETIME,
   "closedBy" TEXT,"closedAt" DATETIME,"statusReason" TEXT)''')
  c.execute('CREATE INDEX IF NOT EXISTS "ProductionStockOrder_status_createdAt_idx" ON "ProductionStockOrder"("status","createdAt")')
  c.execute('''CREATE TABLE IF NOT EXISTS "ProductionMaterialReceipt"(
   "id" INTEGER PRIMARY KEY AUTOINCREMENT,
   "stockOrderId" INTEGER NOT NULL REFERENCES "ProductionStockOrder"("id") ON DELETE RESTRICT,
   "stockLotId" INTEGER NOT NULL UNIQUE REFERENCES "StockLot"("id") ON DELETE RESTRICT,
   "qty" REAL NOT NULL CHECK("qty">0),"status" TEXT NOT NULL DEFAULT 'quarantine' CHECK("status" IN ('quarantine','released','rejected')),
   "receivedBy" TEXT NOT NULL,"receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   "decidedBy" TEXT,"decidedAt" DATETIME,"reason" TEXT)''')
  c.execute('CREATE INDEX IF NOT EXISTS "ProductionMaterialReceipt_stockOrderId_status_idx" ON "ProductionMaterialReceipt"("stockOrderId","status")')
  c.execute('''CREATE TRIGGER IF NOT EXISTS "gocmd_mts_receipt_immutable"
  BEFORE UPDATE OF "stockOrderId","stockLotId","qty","receivedBy","receivedAt" ON "ProductionMaterialReceipt"
  BEGIN SELECT RAISE(ABORT,'GOCMD_MTS_RECEIPT_IMMUTABLE'); END''')
  c.execute('''CREATE TRIGGER IF NOT EXISTS "gocmd_mts_receipt_no_delete"
  BEFORE DELETE ON "ProductionMaterialReceipt"
  BEGIN SELECT RAISE(ABORT,'GOCMD_MTS_RECEIPT_NO_DELETE'); END''')
  # Source physique et évènements reçus doivent rester non modifiables,
  # même après livraison / remboursement / changement de statut qualité.
  c.execute('''CREATE TRIGGER IF NOT EXISTS "gocmd_finished_receipt_immutable_update"
    BEFORE UPDATE ON "FinishedStockMovement" WHEN OLD."type"='received_quarantine'
    BEGIN SELECT RAISE(ABORT,'GOCMD_FINISHED_RECEIPT_IMMUTABLE'); END''')
  c.execute('''CREATE TRIGGER IF NOT EXISTS "gocmd_finished_receipt_immutable_delete"
    BEFORE DELETE ON "FinishedStockMovement" WHEN OLD."type"='received_quarantine'
    BEGIN SELECT RAISE(ABORT,'GOCMD_FINISHED_RECEIPT_IMMUTABLE'); END''')
  c.execute('''CREATE TRIGGER IF NOT EXISTS "gocmd_finished_lot_provenance_immutable"
    BEFORE UPDATE OF "sourceRef","workOrderId","productId" ON "FinishedStockLot"
    BEGIN SELECT RAISE(ABORT,'GOCMD_FINISHED_LOT_PROVENANCE_IMMUTABLE'); END''')
  c.execute('''CREATE TRIGGER IF NOT EXISTS "gocmd_mts_of_no_delete"
  BEFORE DELETE ON "ProductionStockOrder"
  BEGIN SELECT RAISE(ABORT,'GOCMD_MTS_OF_NO_DELETE'); END''')
  if c.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('Violation FK migration')
  if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Integrite SQLite invalide')
  c.commit()
 except:
  c.rollback();raise
print('PASS MTS migration ; copie de securite :',backup)
