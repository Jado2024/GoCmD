"""Contrôles P5.15.26 : migration additive, invariants SQL, lecture des cumuls immuables.
Ce test SQL n'est pas une recette HTTP de production.
"""
import pathlib,sqlite3,subprocess,sys,tempfile,shutil
ROOT=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='gocmd_mts_') as d:
 f=pathlib.Path(d)/'test.db'
 shutil.copy2(ROOT/'db/custom.db',f)
 def upgrade(script):
  return subprocess.run([sys.executable,str(ROOT/'scripts'/script),'--db',str(f),'--apply'],capture_output=True,text=True,check=True).stdout
 upgrade('upgrade_replenishment_p51525.py')
 upgrade('upgrade_production_mts_p51526.py')
 upgrade('upgrade_production_mts_p51526.py')
 with sqlite3.connect(f) as c:
  c.execute('PRAGMA foreign_keys=ON')
  tables={x[0] for x in c.execute("select name from sqlite_master where type='table'")}
  assert {'ProductionStockOrder','ProductionMaterialReceipt','FinishedStockMovement','FinishedStockLot'}<=tables
  assert not c.execute('PRAGMA foreign_key_check').fetchall()
  assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
  m=c.execute("SELECT id,unit FROM Material WHERE isManufactured=1 LIMIT 1").fetchone()
  if not m:m=c.execute('SELECT id,unit FROM Material LIMIT 1').fetchone()
  assert m
  c.execute("INSERT INTO ProductionReplenishmentRequest(ref,materialId,qty,unit,reason,createdBy,status) VALUES(?,?,?,?,?,?,?)",('DPR-TEST-P51526',m[0],10,m[1],'Test de commande production','proposeur','approved'))
  request_id=c.execute('SELECT id FROM ProductionReplenishmentRequest WHERE ref=?',('DPR-TEST-P51526',)).fetchone()[0]
  c.execute("INSERT INTO ProductionStockOrder(ref,requestId,createdBy) VALUES(?,?,?)",('OFMTS-TEST-P51526',request_id,'chef'))
  ofid=c.execute('SELECT id FROM ProductionStockOrder WHERE requestId=?',(request_id,)).fetchone()[0]
  try:c.execute("INSERT INTO ProductionStockOrder(ref,requestId,createdBy) VALUES(?,?,?)",('OFMTS-TEST-DOUBLE',request_id,'chef'))
  except sqlite3.IntegrityError:pass
  else:raise AssertionError('Deux OF MTS autorises pour une DPR')
  c.execute('INSERT INTO StockLot(materialId,lotCode,status,qty,provenanceKey) VALUES(?,?,?,?,?)',(m[0],'LOT-P51526','quarantine',10,f'MTS-{ofid}'))
  lot_id=c.execute('SELECT last_insert_rowid()').fetchone()[0]
  c.execute('INSERT INTO ProductionMaterialReceipt(stockOrderId,stockLotId,qty,receivedBy) VALUES(?,?,?,?)',(ofid,lot_id,10,'magasin'))
  # Une livraison future ne modifie jamais le cumul physique enregistré.
  assert c.execute('SELECT SUM(qty) FROM ProductionMaterialReceipt WHERE stockOrderId=?',(ofid,)).fetchone()[0]==10
  for sql in ['UPDATE ProductionMaterialReceipt SET qty=5 WHERE stockOrderId=?','DELETE FROM ProductionMaterialReceipt WHERE stockOrderId=?']:
   try:c.execute(sql,(ofid,))
   except sqlite3.IntegrityError as e:assert 'GOCMD_MTS_RECEIPT_' in str(e)
   else:raise AssertionError('Historique reception modifiable')
  c.execute("UPDATE ProductionMaterialReceipt SET status='released',decidedBy='qualite' WHERE stockOrderId=?",(ofid,))
  assert c.execute('SELECT status FROM ProductionMaterialReceipt WHERE stockOrderId=?',(ofid,)).fetchone()[0]=='released'
  prod=c.execute("SELECT id FROM Product WHERE unit='u' AND materialId IS NULL LIMIT 1").fetchone()
  if prod:
   c.execute("INSERT INTO FinishedStockLot(productId,lotCode,status,qty,sourceRef,receivedBy) VALUES(?,?,?,?,?,?)",(prod[0],'LOT-FIN-P51526','available',10,'DPR-FIN-TEST','magasin'))
   fid=c.execute('SELECT last_insert_rowid()').fetchone()[0]
   c.execute("INSERT INTO FinishedStockMovement(ref,lotId,type,qty,document,actor) VALUES(?,?,?,?,?,?)",('MFP-P51526-TEST',fid,'received_quarantine',10,'DPR-FIN-TEST','magasin'))
   c.execute('UPDATE FinishedStockLot SET qty=5 WHERE id=?',(fid,))
   try:c.execute('UPDATE FinishedStockMovement SET qty=5 WHERE lotId=? AND type=\'received_quarantine\'',(fid,))
   except sqlite3.IntegrityError as exc:assert 'GOCMD_FINISHED_RECEIPT_IMMUTABLE' in str(exc)
   else:raise AssertionError('Historique fini modifiable')
   assert c.execute("SELECT SUM(fm.qty) FROM FinishedStockMovement fm JOIN FinishedStockLot fl ON fm.lotId=fl.id WHERE fm.type='received_quarantine' AND fl.sourceRef='DPR-FIN-TEST'").fetchone()[0]==10
   assert c.execute('SELECT qty FROM FinishedStockLot WHERE id=?',(fid,)).fetchone()[0]==5
  c.rollback()
print('PASS P5.15.26 : migration 2 fois, unicite OF, FK, immutabilite historique, reception 10 / solde 5')
