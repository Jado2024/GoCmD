#!/usr/bin/env python3
"""OF simplifiés : migration additive, sauvegarde externe obligatoire avec --apply."""
import argparse, pathlib, sqlite3, sys
SQL = [
 '''CREATE TABLE IF NOT EXISTS "WorkOrder" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "ref" TEXT NOT NULL UNIQUE,
  "orderId" INTEGER NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderLineId" INTEGER NOT NULL UNIQUE REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft','approved','in_progress','completed','cancelled')),
  "snapshotJson" TEXT NOT NULL CHECK (json_valid("snapshotJson")),
  "totalPieces" INTEGER NOT NULL CHECK ("totalPieces">0 AND "totalPieces"<=1000),
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedBy" TEXT,
  "approvedAt" DATETIME,
  "startedBy" TEXT,
  "startedAt" DATETIME,
  "completedBy" TEXT,
  "completedAt" DATETIME
 )''',
 'CREATE INDEX IF NOT EXISTS "WorkOrder_orderId_status_idx" ON "WorkOrder"("orderId","status")',
 'CREATE INDEX IF NOT EXISTS "WorkOrder_status_createdAt_idx" ON "WorkOrder"("status","createdAt")',
 '''CREATE TRIGGER IF NOT EXISTS "WorkOrder_guard_parent_insert"
 BEFORE INSERT ON "WorkOrder"
 WHEN (SELECT "orderId" FROM "OrderLine" WHERE "id"=NEW."orderLineId") IS NULL
   OR (SELECT "orderId" FROM "OrderLine" WHERE "id"=NEW."orderLineId")<>NEW."orderId"
 BEGIN SELECT RAISE(ABORT,'OF_ORDER_LINE_MISMATCH'); END''',
 '''CREATE TRIGGER IF NOT EXISTS "WorkOrder_guard_parent_update"
 BEFORE UPDATE OF "orderId","orderLineId" ON "WorkOrder"
 WHEN (SELECT "orderId" FROM "OrderLine" WHERE "id"=NEW."orderLineId") IS NULL
   OR (SELECT "orderId" FROM "OrderLine" WHERE "id"=NEW."orderLineId")<>NEW."orderId"
 BEGIN SELECT RAISE(ABORT,'OF_ORDER_LINE_MISMATCH'); END''',
]
def migrate(db,apply=False,backup=None):
 target=pathlib.Path(db).resolve()
 if not target.is_file():raise ValueError('Base de données absente')
 con=sqlite3.connect(target.as_uri()+'?mode=ro' if not apply else str(target),uri=not apply)
 try:
  con.execute('PRAGMA foreign_keys=ON')
  assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
  assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
  needed={'Order','OrderLine','OrderPiece','SalesDocCounter','AuditEvent'}
  tables={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  if not needed <= tables:raise ValueError('Schéma GoCmd incomplet : '+str(sorted(needed-tables)))
  if not apply:
   print('DRY-RUN OF : '+('déjà installée' if 'WorkOrder' in tables else 'migration requise'))
   return
  if not backup:raise ValueError('--backup externe obligatoire')
  dst=pathlib.Path(backup).resolve()
  if dst.exists() or dst.parent==target.parent or dst==target:
   raise ValueError('Sauvegarde nouvelle hors du dossier source obligatoire')
  dst.parent.mkdir(parents=True,exist_ok=True)
  with sqlite3.connect(dst) as out:con.backup(out)
  con.execute('BEGIN IMMEDIATE')
  try:
   existing=con.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='WorkOrder'").fetchone()
   # Anciennes installations : élargir le CHECK du statut sans perdre les
   # numéros, captures, identifiants ni les journaux (sauvegarde préalable).
   if existing and "'cancelled'" not in existing[0]:
    if con.execute("SELECT name FROM sqlite_master WHERE name='WorkOrder_legacy'").fetchone():
     raise ValueError('Migration OF précédente inachevée : intervention requise')
    before_count=con.execute('SELECT COUNT(*) FROM "WorkOrder"').fetchone()[0]
    con.execute('ALTER TABLE "WorkOrder" RENAME TO "WorkOrder_legacy"')
    con.execute(SQL[0])
    columns=('id','ref','orderId','orderLineId','status','snapshotJson','totalPieces',
             'createdBy','createdAt','approvedBy','approvedAt','startedBy','startedAt','completedBy','completedAt')
    cols=','.join('"'+col+'"' for col in columns)
    con.execute(f'INSERT INTO "WorkOrder" ({cols}) SELECT {cols} FROM "WorkOrder_legacy"')
    if con.execute('SELECT COUNT(*) FROM "WorkOrder"').fetchone()[0]!=before_count:
     raise ValueError('Reprise OF incomplète : transaction annulée')
    con.execute('DROP TABLE "WorkOrder_legacy"')
   for sql in SQL:con.execute(sql)
   if con.execute('PRAGMA foreign_key_check').fetchall():
    raise ValueError('Clés étrangères non conformes après migration OF')
   con.commit()
  except Exception:
   con.rollback();raise
  assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
  assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
  print('PASS migration OF ; sauvegarde :',dst)
 finally:con.close()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--apply',action='store_true');p.add_argument('--backup');a=p.parse_args()
 try:migrate(a.db,a.apply,a.backup)
 except Exception as e:print('ERROR',e,file=sys.stderr);sys.exit(1)
