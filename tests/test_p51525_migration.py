import tempfile, pathlib, shutil, sqlite3, subprocess, sys
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
 db=pathlib.Path(tmp)/'test.db'
 shutil.copy2(root/'db/custom.db',db)
 with sqlite3.connect(db) as c:
  before=(c.execute('select count(*) from Product').fetchone()[0],c.execute('select count(*) from Material').fetchone()[0])
 for _ in range(2):
  r=subprocess.run([sys.executable,str(root/'scripts/upgrade_replenishment_p51525.py'),'--db',str(db),'--apply'],capture_output=True,text=True)
  assert r.returncode==0, r.stderr
 with sqlite3.connect(db) as c:
  pcols={x[1] for x in c.execute('PRAGMA table_info(Product)')};mcols={x[1] for x in c.execute('PRAGMA table_info(Material)')}
  assert {'minStock','targetStock','pendingCatalogUnitPrice','catalogPriceProposedBy'}<=pcols
  assert 'targetStock' in mcols
  assert c.execute('select count(*) from ProductionReplenishmentRequest').fetchone()[0]==0
  assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
  assert before==(c.execute('select count(*) from Product').fetchone()[0],c.execute('select count(*) from Material').fetchone()[0])
  # AUDIT P5.15.27-A : la base livree contient deja l index P5.15.27
  # ProductionReplenishmentRequest_status_id_idx (upgrade_mts_rework_cost_p51527.py)
  # en plus des 2 index declares au schema. La migration p51525 reste additive
  # et idempotente ; elle ne doit ni retirer ni dupliquer ces index.
  assert c.execute('select count(*) from sqlite_master where type="index" and name like "ProductionReplenishmentRequest%"').fetchone()[0]==3
print('PASS migration additive / idempotence / integrite / comptages')
