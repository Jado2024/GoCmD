#!/usr/bin/env python3
"""P5.15.27 additive, idempotent: finance costing and MTS query indexes.
Never run on a production database without a tested backup; --apply required.
Does not modify any existing historical receipt or stock quantity.
"""
import argparse,datetime,pathlib,sqlite3
p=argparse.ArgumentParser();p.add_argument('--db',default='db/custom.db');p.add_argument('--apply',action='store_true');a=p.parse_args()
if not a.apply:raise SystemExit('DRY-RUN: --apply required after independent backup and restore test')
f=pathlib.Path(a.db).resolve()
if not f.exists():raise SystemExit('Missing database')
backup=f.with_name(f.name+'.bak-p51527-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f'))
with sqlite3.connect(f) as src,sqlite3.connect(backup) as dst:src.backup(dst)
with sqlite3.connect(f,timeout=40) as db:
 db.execute('PRAGMA foreign_keys=ON');db.execute('BEGIN IMMEDIATE')
 try:
  db.execute('''CREATE TABLE IF NOT EXISTS "ProductionMaterialCostApproval"(
   "id" INTEGER PRIMARY KEY AUTOINCREMENT,
   "stockOrderId" INTEGER NOT NULL UNIQUE REFERENCES "ProductionStockOrder"("id") ON DELETE RESTRICT,
   "unitCost" DECIMAL NOT NULL CHECK(CAST("unitCost" AS REAL)>0),
   "currency" TEXT NOT NULL DEFAULT 'MAD' CHECK("currency"='MAD'),
   "approvedBy" TEXT NOT NULL,
   "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   "reason" TEXT NOT NULL CHECK(length("reason")>=10))''')
  db.execute('''CREATE TRIGGER IF NOT EXISTS "gocmd_mts_cost_immutable_update"
   BEFORE UPDATE ON "ProductionMaterialCostApproval"
   BEGIN SELECT RAISE(ABORT,'GOCMD_MTS_COST_IMMUTABLE'); END''')
  db.execute('''CREATE TRIGGER IF NOT EXISTS "gocmd_mts_cost_immutable_delete"
   BEFORE DELETE ON "ProductionMaterialCostApproval"
   BEGIN SELECT RAISE(ABORT,'GOCMD_MTS_COST_IMMUTABLE'); END''')
  db.execute('CREATE INDEX IF NOT EXISTS "ProductionMaterialReceipt_status_id_idx" ON "ProductionMaterialReceipt"("status","id")')
  db.execute('CREATE INDEX IF NOT EXISTS "ProductionReplenishmentRequest_status_id_idx" ON "ProductionReplenishmentRequest"("status","id")')
  db.execute('CREATE INDEX IF NOT EXISTS "FinishedStockLot_status_id_idx" ON "FinishedStockLot"("status","id")')
  db.execute('CREATE INDEX IF NOT EXISTS "FinishedStockMovement_type_lotId_idx" ON "FinishedStockMovement"("type","lotId")')
  db.execute('CREATE INDEX IF NOT EXISTS "ProductionStockOrder_requestId_status_idx" ON "ProductionStockOrder"("requestId","status")')
  db.execute('''CREATE TABLE IF NOT EXISTS "ProductionReworkApproval"(
   "id" INTEGER PRIMARY KEY AUTOINCREMENT,
   "ref" TEXT NOT NULL UNIQUE,
   "sourceKind" TEXT NOT NULL CHECK("sourceKind" IN ('material_receipt','finished_lot')),
   "sourceId" INTEGER NOT NULL,
   "productionRef" TEXT NOT NULL,
   "qty" REAL NOT NULL CHECK("qty">0),
   "usedQty" REAL NOT NULL DEFAULT 0 CHECK("usedQty">=0 AND "usedQty"<="qty"+0.000001),
   "unit" TEXT NOT NULL,
   "approvedBy" TEXT NOT NULL,
   "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   "reason" TEXT NOT NULL CHECK(length("reason")>=10),
   UNIQUE("sourceKind","sourceId"))''')
  db.execute('''CREATE TRIGGER IF NOT EXISTS "gocmd_rework_approval_immutable"
   BEFORE UPDATE OF "ref","sourceKind","sourceId","productionRef","qty","unit","approvedBy","approvedAt","reason" ON "ProductionReworkApproval"
   BEGIN SELECT RAISE(ABORT,'GOCMD_REWORK_APPROVAL_IMMUTABLE'); END''')
  db.execute('''CREATE TRIGGER IF NOT EXISTS "gocmd_rework_approval_no_delete"
   BEFORE DELETE ON "ProductionReworkApproval"
   BEGIN SELECT RAISE(ABORT,'GOCMD_REWORK_APPROVAL_IMMUTABLE'); END''')
  if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('SQL INTEGRITY')
  db.commit()
 except:
  db.rollback();raise
print('PASS: incremental MTS cost schema + indexes, backup:',backup)
