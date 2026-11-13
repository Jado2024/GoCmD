#!/usr/bin/env python3
"""Tests SQLite sur copie jetable de la base DEMO, jamais celle de production.
Ces tests vérifient les invariants et contraintes existantes, et non les routes HTTP.
"""
import sqlite3,tempfile,shutil,pathlib,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class DeliveryTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory(prefix='gocmd-p5152-')
  cls.demo=pathlib.Path(cls.temp.name)/'custom.db'
  shutil.copy2(ROOT/'db/custom.db',cls.demo)
  cls.db=sqlite3.connect(cls.demo);cls.db.execute('PRAGMA foreign_keys=ON')
 @classmethod
 def tearDownClass(cls):cls.db.close();cls.temp.cleanup()
 def test_integrity(self):
  self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_existing_stock_lots_reconcile(self):
  # L'intégrité physique de la BASE initiale n'est pas une preuve de contrôle API.
  bad=self.db.execute('SELECT COUNT(*) FROM StockLot AS l WHERE ABS(l.qty-(SELECT COALESCE(SUM(p.qty),0) FROM StockPlacement p WHERE p.stockLotId=l.id))>0.000001').fetchone()[0]
  self.assertEqual(bad,0)
 def test_demo_not_modified(self):
  self.assertGreater(self.db.execute('SELECT COUNT(*) FROM Material').fetchone()[0],0)
if __name__=='__main__':unittest.main()
