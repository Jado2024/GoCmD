"""Contrats statiques P0 et sauvegarde SQLite sur base éphémère.
Ne remplace pas tsc, next build et recette HTTP : tests d'intégration obligatoires.
"""
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

root=Path(__file__).resolve().parents[1]
bc=(root/'src/app/api/supplier-orders/route.ts').read_text()
dash=(root/'src/app/api/dashboard/route.ts').read_text()
schema=(root/'prisma/schema.prisma').read_text()
checks={
 'NextRef import explicitly declared': 'import { nextRef } from "@/lib/erp-server"' in bc,
 'BC created with proper transaction': 'await nextRef("BC","supplierOrder",tx)' in bc,
 'Dashboard decimal explicitly serialized': 'averageCost: canSeeCosts ? (m.averageCost == null ? null : String(m.averageCost)) : null' in dash,
 'StockLot UNIQUE syntax intact': '@@unique([materialId, lotCode, status, provenanceKey])' in schema,
 'StockLot INDEX syntax intact': '@@index([materialId,status])' in schema,
 'End-to-end HTTP recipe present': (root/'tests/http-p2p-recipe.cjs').is_file(),
}
with tempfile.TemporaryDirectory() as tmp:
 tmp=Path(tmp)
 db=tmp/'test.db'
 with sqlite3.connect(db) as conn:
  conn.executescript('PRAGMA foreign_keys=ON; CREATE TABLE sample(id INTEGER PRIMARY KEY, qty INTEGER NOT NULL); INSERT INTO sample VALUES (1,12);')
 cmd=[sys.executable,str(root/'scripts/backup_sqlite.py'),'--source',str(db),'--output-dir',str(tmp/'backups')]
 run=subprocess.run(cmd,capture_output=True,text=True)
 checks['SQLite online backup exits successfully']=run.returncode==0
 copies=list((tmp/'backups').glob('gocmd_backup_*.db'))
 checks['Backup is readable and restores data']=len(copies)==1 and sqlite3.connect(copies[0]).execute('SELECT qty FROM sample').fetchone()[0]==12

for name,ok in checks.items():
 print(('PASS' if ok else 'FAIL'),name)
if not all(checks.values()):
 raise SystemExit(1)
print('PASS V11: 8 static/backup tests. BUILD + HTTP integration NOT covered.')
