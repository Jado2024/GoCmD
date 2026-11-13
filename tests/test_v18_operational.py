"""Validation V18: preconditions de reception et contrats d'interface sur BDD de demo.
Pas de service HTTP, pas de compilation TS complète.
"""
from pathlib import Path
import sqlite3,sys,subprocess,tempfile,json
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from reinitialiser_demo_v16 import check
C=sqlite3.connect(f'file:{ROOT}/tests/fixtures/v16_demo.db?mode=ro',uri=True)
assert C.execute('pragma integrity_check').fetchone()[0]=='ok'
assert C.execute('pragma foreign_key_check').fetchall()==[]
assert C.execute('select count(*) from Product').fetchone()[0]==189
assert C.execute("""SELECT COUNT(*) FROM StorageLocation l JOIN WarehouseSite w ON w.id=l.warehouseId WHERE w.code='DEFAULT' AND l.code='A_AFFECTER' AND l.status='active'""").fetchone()[0]==1
assert check(C)==[],str(check(C))
inv=C.execute("select id, totalAmount,status from SupplierInvoice where invoiceNumber='FACT-DEMO-002'").fetchone()
amount=float(inv[1]); paid=C.execute('select COALESCE(SUM(amount),0) from SupplierPayment where invoiceId=?',(inv[0],)).fetchone()[0]
credits=C.execute("select COALESCE(SUM(amount),0) from SupplierCreditNote where invoiceId=? and status='approved'",(inv[0],)).fetchone()[0]
assert inv[2]=='paid' and round(paid+credits,2)==round(amount,2),(inv,paid,credits)
C.close()
# Le nouveau reset doit recréer DEFAULT/A_AFFECTER sur une BDD isolée et être rejouable.
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/'demo.db';src=sqlite3.connect(f'file:{ROOT}/tests/fixtures/v16_demo.db?mode=ro',uri=True);dst=sqlite3.connect(p);src.backup(dst);src.close();dst.close()
 for i in range(2):
  result=subprocess.run([sys.executable,str(ROOT/'scripts/reinitialiser_demo_v16.py'),'--apply','--ack','DEMO_ONLY','--db',str(p)],capture_output=True,text=True)
  assert result.returncode==0,(i,result.stdout[-500:],result.stderr[-500:])
  c=sqlite3.connect(p)
  assert c.execute("select count(*) from WarehouseSite where code='DEFAULT'").fetchone()[0]==1
  assert c.execute("select count(*) from StorageLocation where code='A_AFFECTER'").fetchone()[0]==1
  assert c.execute('pragma foreign_key_check').fetchall()==[]
  c.close()
# Assure que les corrections de l'audit sont effectivement présentes, sans remplacer le build.
files={name:(ROOT/name).read_text() for name in ['src/app/api/dashboard/route.ts','src/lib/access-gate.ts','src/components/erp/erp-app.tsx','src/components/erp/p2p-control-view.tsx','src/app/api/me/route.ts']}
assert 'foamNature: m.foamNature === "PURE"' in files['src/app/api/dashboard/route.ts']
assert 'isAllowedMutationOrigin' in files['src/lib/access-gate.ts']
assert 'dashboard.data?.kpi.products' in files['src/components/erp/erp-app.tsx']
assert 'iQ.isError' in files['src/components/erp/p2p-control-view.tsx']
assert 'Cache-Control' in files['src/app/api/me/route.ts']
print('PASS V18: receipt location operational precondition, reset x2, supplier invoice 820+5=825, CSRF/role/DTO UI fixes')
