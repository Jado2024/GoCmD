"""V2 DEMO checks — static SQLite invariants and bounded destructive guard tests.

Does not require a live server. All bad SQL inputs are executed ONLY in-memory.
"""
import csv
import pathlib
import sqlite3
import subprocess
import sys
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
DB=ROOT/'db/custom.db'
MAP=ROOT/'db/recodification_v2_mapping.csv'

class DemoV2(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.db=sqlite3.connect(DB)
  cls.db.row_factory=sqlite3.Row
 @classmethod
 def tearDownClass(cls):cls.db.close()
 def test_01_marker(self):
  self.assertEqual(self.db.execute("SELECT count(*) FROM WarehouseSite WHERE code='SODEPI-DEMO'").fetchone()[0],1)
 def test_02_sqlite_integrity(self):
  self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_03_catalogue_counts(self):
  for t,expected in [('Material',82),('Product',218),('SupplierMaterial',135),('StockLot',64),('Supplier',18),('Client',10),('GoCmdUser',9)]:
   with self.subTest(t=t):self.assertEqual(self.db.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0],expected)
 def test_04_no_scenarios_delivered(self):
  for t in ('Order','OrderLine','WorkOrder','PurchaseRequest','SupplierOrder','SalesInvoice'):
   with self.subTest(t=t):self.assertEqual(self.db.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0],0)
 def test_05_identity_complete(self):
  for t in ('Material','Product'):
   with self.subTest(t=t):
    self.assertEqual(self.db.execute(f'SELECT count(*) FROM "{t}" WHERE canonicalIdentity IS NULL OR technicalAttributesJson IS NULL').fetchone()[0],0)
    self.assertEqual(self.db.execute(f'SELECT count(*) FROM (SELECT canonicalIdentity,count(*) n FROM "{t}" GROUP BY canonicalIdentity HAVING n>1)').fetchone()[0],0)
 def test_06_trade_links_physical_identity(self):
  total=self.db.execute('SELECT COUNT(*) FROM Product WHERE materialId IS NOT NULL').fetchone()[0]
  self.assertGreater(total,0)
  self.assertEqual(self.db.execute('''SELECT COUNT(*) FROM Product p JOIN Material m ON m.id=p.materialId
       WHERE p.sku<>m.ref OR p.canonicalIdentity<>m.canonicalIdentity''').fetchone()[0],0)
 def test_07_supplier_codes_unambiguous(self):
  self.assertEqual(self.db.execute('SELECT count(*) FROM SupplierMaterial WHERE supplierSku IS NOT NULL AND TRIM(supplierSku)<>\'\' AND supplierLookupKey IS NULL').fetchone()[0],0)
  self.assertEqual(self.db.execute('SELECT count(*) FROM (SELECT supplierLookupKey,count(*) n FROM SupplierMaterial WHERE supplierLookupKey IS NOT NULL GROUP BY supplierLookupKey HAVING n>1)').fetchone()[0],0)
 def test_08_mapping(self):
  with MAP.open(encoding='utf-8-sig',newline='') as f:items=list(csv.DictReader(f))
  self.assertEqual(len(items),300)
  self.assertEqual({i['table'] for i in items},{'Material','Product'})
 def test_09_v2_columns(self):
  for t,col in [('OrderLine','kind'),('OrderLine','genericTemplate'),('OrderLine','technicalSnapshotJson'),('Product','isOrderScoped'),('SupplierMaterial','supplierLookupKey')]:
   with self.subTest(t=t,col=col):
    self.assertIn(col,{r[1] for r in self.db.execute(f'PRAGMA table_info("{t}")')})
 def in_memory(self):
  other=sqlite3.connect(':memory:')
  self.db.backup(other)
  other.execute('PRAGMA foreign_keys=ON')
  return other
 def test_10_canonical_duplicate_rejected(self):
  with self.in_memory() as c:
   ids=c.execute('SELECT id FROM Material ORDER BY id LIMIT 2').fetchall()
   self.assertEqual(len(ids),2)
   with self.assertRaises(sqlite3.IntegrityError):
    c.execute('UPDATE Material SET canonicalIdentity=(SELECT canonicalIdentity FROM Material WHERE id=?) WHERE id=?',(ids[0][0],ids[1][0]))
 def test_11_cross_type_ref_collision_rejected(self):
  with self.in_memory() as c:
   prod=c.execute('SELECT id FROM Product WHERE materialId IS NULL ORDER BY id LIMIT 1').fetchone()[0]
   mat=c.execute('SELECT ref FROM Material ORDER BY id LIMIT 1').fetchone()[0]
   with self.assertRaises(sqlite3.IntegrityError):c.execute('UPDATE Product SET sku=? WHERE id=?',(mat,prod))
 def test_12_supplier_normalized_collision_rejected(self):
  with self.in_memory() as c:
   chosen=c.execute('''SELECT a.id,b.supplierLookupKey FROM SupplierMaterial a JOIN SupplierMaterial b
    ON a.supplierId=b.supplierId AND a.id<>b.id WHERE b.supplierLookupKey IS NOT NULL LIMIT 1''').fetchone()
   self.assertIsNotNone(chosen)
   with self.assertRaises(sqlite3.IntegrityError):c.execute('UPDATE SupplierMaterial SET supplierLookupKey=? WHERE id=?',(chosen[1],chosen[0]))
 def test_13_production_reset_rejected(self):
  # Script guard checks the path before opening or replacing it.
  cmd=[sys.executable,str(ROOT/'scripts/recreer_demo_sodepi_p51523.py'),'--db','/tmp/prod_should_never_reset.db','--apply','--ack','DEMO_ONLY']
  proc=subprocess.run(cmd,capture_output=True,text=True,timeout=30)
  self.assertNotEqual(proc.returncode,0)
  self.assertIn('Refus',proc.stderr)
 def test_14_catalogue_old_demo_records_not_used_as_live_orders(self):
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM Product WHERE isOrderScoped=1').fetchone()[0],0)
 def test_15_stock_consistency(self):
  bad=self.db.execute('''SELECT count(*) FROM Material m LEFT JOIN (SELECT materialId,sum(qty) q
     FROM StockLot WHERE status='available' GROUP BY materialId) l ON l.materialId=m.id
     WHERE ABS(m.stockQty-COALESCE(l.q,0))>0.00001''').fetchone()[0]
  self.assertEqual(bad,0)

if __name__=='__main__':unittest.main(verbosity=2)
