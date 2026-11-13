import importlib.util, tempfile, sqlite3, shutil, pathlib, subprocess, sys, hashlib
root=pathlib.Path(__file__).resolve().parents[1]
script=root/'scripts/upgrade_sales_reservation_p5154.py'
original=root/'db/custom.db'
assert original.exists()
with tempfile.TemporaryDirectory() as temporary:
 temp=pathlib.Path(temporary); db=temp/'db'/'test.db';db.parent.mkdir()
 shutil.copy2(original,db)
 def run(*args):return subprocess.run([sys.executable,str(script),'--db',str(db),*args],capture_output=True,text=True)
 before=hashlib.sha256(db.read_bytes()).hexdigest()
 dry=run();assert dry.returncode==0,dry.stderr
 assert hashlib.sha256(db.read_bytes()).hexdigest()==before,'Dry-run a modifié la base !'
 no_backup=run('--apply');assert no_backup.returncode!=0
 backup=temp/'backups'/'safe-copy.db'
 res=run('--apply','--backup',str(backup));assert res.returncode==0,res.stderr
 assert backup.exists()
 with sqlite3.connect(backup) as b:assert b.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
 con=sqlite3.connect(db)
 assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 assert not con.execute('PRAGMA foreign_key_check').fetchall()
 for name in ('fulfillmentStatus','fulfillmentReason','fulfillmentActor','fulfillmentChangedAt'):
  assert name in {r[1] for r in con.execute('PRAGMA table_info("Order")')}
 assert {'requestKey','requestHash'} <= {r[1] for r in con.execute('PRAGMA table_info("SalesDelivery")')}
 assert con.execute("SELECT name FROM sqlite_master WHERE name='SalesStockReservation'").fetchone()
 # aucune suppression des commandes historiques ni modifications de lots
 with sqlite3.connect(backup) as old:
  for table in ['Material','Product','Order','OrderLine','StockLot','SalesDelivery','SalesStockAllocation','Movement','AuditEvent']:
   assert con.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]==old.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0],table
 con.close()
 again=run('--apply','--backup',str(temp/'backups'/'backup2.db'));assert again.returncode==0,again.stderr
 print('PASS P5.15.4 migration : dry-run, backup, idempotence, intégrité, conservation historiques')

# Contre-tests SQL uniquement, sur une copie, aucun appel HTTP ni effet sur la base livrée.
with tempfile.TemporaryDirectory() as temporary:
 from pathlib import Path
 copy=Path(temporary)/'guard.db'
 shutil.copy2(original,copy)
 second_backup=Path(temporary)/'snapshot'/'before-triggers.db'
 migration=subprocess.run([sys.executable,str(script),'--db',str(copy),'--apply','--backup',str(second_backup)],capture_output=True,text=True)
 assert migration.returncode==0,migration.stderr
 db_con=sqlite3.connect(copy)
 db_con.execute('PRAGMA foreign_keys=ON')
 lot=db_con.execute('''SELECT l.id,l.materialId,l.qty FROM StockLot l JOIN Material m ON m.id=l.materialId
   LEFT JOIN Product p ON p.materialId=m.id
   WHERE l.status="available" AND l.qty>=10 AND p.id IS NULL ORDER BY l.id LIMIT 1''').fetchone()
 assert lot, 'fixture sans lot disponible'
 lot_id,material_id,physical=lot
 material=db_con.execute('SELECT ref,name,unit FROM Material WHERE id=?',(material_id,)).fetchone()
 db_con.execute('UPDATE Material SET isSellable=1,salesUnit=unit,salesUnitPrice=40 WHERE id=?',(material_id,))
 db_con.execute('INSERT INTO Product (sku,name,family,model,length,width,height,unit,unitPrice,status,materialId,unitsPerSale) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
   (material[0],material[1],'NEGOCE',material[0],1,1,1,material[2],40,'active',material_id,1))
 product_id=db_con.execute('SELECT last_insert_rowid()').fetchone()[0]
 client_id=db_con.execute('SELECT id FROM Client LIMIT 1').fetchone()[0]
 db_con.execute('INSERT INTO "Order" (ref,clientId,status) VALUES (?,?,?)',('CMD-P5154-SQL-FIXTURE',client_id,'ready'))
 order_id=db_con.execute('SELECT last_insert_rowid()').fetchone()[0]
 def line():
  db_con.execute('INSERT INTO OrderLine (orderId,productId,qty,unit,unitPrice,stockUnit,stockUnitsPerSale) VALUES (?,?,?,?,?,?,?)',
    (order_id,product_id,physical,material[2],40,material[2],1))
  return db_con.execute('SELECT last_insert_rowid()').fetchone()[0]
 a,b=line(),line()
 db_con.execute('INSERT INTO SalesStockReservation(orderLineId,stockLotId,qty,createdBy) VALUES (?,?,?,?)',(a,lot_id,5,'test_sales'))
 def must_reject(sql,args):
  try:
   db_con.execute(sql,args)
   raise AssertionError('La base accepte une violation réservations')
  except sqlite3.IntegrityError:
   pass
 must_reject('INSERT INTO SalesStockReservation(orderLineId,stockLotId,qty,createdBy) VALUES (?,?,?,?)',(b,lot_id,physical-4,'test_sales'))
 must_reject('UPDATE StockLot SET qty=? WHERE id=?',(4,lot_id))
 must_reject('UPDATE StockLot SET status=? WHERE id=?',('quarantine',lot_id))
 must_reject('INSERT INTO SalesStockReservation(orderLineId,stockLotId,qty,createdBy) VALUES (?,?,?,?)',(b,lot_id,-1,'test_sales'))
 db_con.execute('DELETE FROM SalesStockReservation WHERE orderLineId=?',(a,))
 db_con.execute('UPDATE StockLot SET qty=? WHERE id=?',(4,lot_id))
 assert db_con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 db_con.rollback()
 db_con.close()
 print('PASS P5.15.4 SQL: sur-réservation, débit de lot réservé, changement de statut et qty négative refusés (copie isolée)')
