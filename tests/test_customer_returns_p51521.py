import importlib.util,sqlite3,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('ret',ROOT/'scripts/upgrade_customer_returns_p51521.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/'demo.db'
 with sqlite3.connect(p) as c:
  c.executescript('CREATE TABLE SalesDeliveryLine (id INTEGER PRIMARY KEY); CREATE TABLE FinishedStockLot(id INTEGER PRIMARY KEY); INSERT INTO SalesDeliveryLine VALUES (2);')
 assert m.run(p)==True
 assert m.run(p,True)==True
 assert m.run(p,True)==False
 with sqlite3.connect(p) as c:
  c.execute('PRAGMA foreign_keys=ON')
  c.execute('INSERT INTO CustomerReturn(ref,deliveryLineId,qty,unit,pieceIdsJson,reason,requestKey,createdBy) VALUES (?,?,?,?,?,?,?,?)',('RCL-1',2,3,'u','[]','Retour client','token-1','commercial'))
  try:
   c.execute('INSERT INTO CustomerReturn(ref,deliveryLineId,qty,unit,pieceIdsJson,reason,requestKey,createdBy) VALUES (?,?,?,?,?,?,?,?)',('RCL-2',2,3,'u','[]','Retour client','token-1','commercial'))
   raise AssertionError('Duplicate token allowed')
  except sqlite3.IntegrityError:pass
  try:
   c.execute('INSERT INTO CustomerReturn(ref,deliveryLineId,qty,unit,pieceIdsJson,reason,requestKey,createdBy) VALUES (?,?,?,?,?,?,?,?)',('RCL-3',22,3,'u','[]','Retour client','token-3','commercial'))
   raise AssertionError('FK not enforced')
  except sqlite3.IntegrityError:pass
  assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 assert len(list(Path(d).glob('*.avant_retours_clients_*.db')))==1
print('PASS VEN-03: migration, reprise, idempotence, unicité jeton, FK, intégrité')
