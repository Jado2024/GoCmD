import importlib.util,sqlite3,shutil,tempfile
from contextlib import closing
from pathlib import Path
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('migration',root/'scripts/upgrade_safety_p5131.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 f=Path(d)/'copy.db';shutil.copy2(root/'db/custom.db',f)
 with closing(sqlite3.connect(f)) as c:
  tables=['Supplier','Material','SupplierQuoteOffer','SupplierPriceAgreement','SupplierOrder','SupplierOrderLine']
  before={t:c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
 m.upgrade(f);m.upgrade(f)
 with closing(sqlite3.connect(f)) as c:
  after={t:c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
  assert before==after,(before,after)
  for t in ['SupplierQuoteOffer','SupplierPriceAgreement']:
   cols={r[1] for r in c.execute(f'PRAGMA table_info("{t}")')}
   assert {'priceBasis','priceBasisFactor','sourceUnitPrice'}<=cols
   assert c.execute(f'SELECT count(*) FROM "{t}" WHERE priceBasis IS NOT NULL').fetchone()[0]==0
  assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
  assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
print('PASS P5.13.1 : 2 migrations, historiques inchangés, clés étrangères OK')
