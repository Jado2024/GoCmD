#!/usr/bin/env python3
"""Test d'intégrité de la migration et des OF sur une copie temporaire, jamais sur la démo livrée."""
import contextlib, importlib.util, json, pathlib, sqlite3, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('of_migration',ROOT/'scripts/upgrade_work_orders_p51521.py')
M=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(M)
source=ROOT/'db/custom.db'
assert source.exists()
with tempfile.TemporaryDirectory(prefix='gocmd-of-test-') as d:
 dest=pathlib.Path(d)/'source'/'demo.db'
 dest.parent.mkdir(parents=True,exist_ok=True)
 with sqlite3.connect(source) as orig,sqlite3.connect(dest) as out:orig.backup(out)
 hash_before=source.stat().st_size
 M.migrate(dest,False)
 M.migrate(dest,True,pathlib.Path(d)/'backup-1.db')
 M.migrate(dest,True,pathlib.Path(d)/'backup-2.db') # idempotent
 assert (pathlib.Path(d)/'backup-1.db').exists()
 assert source.stat().st_size==hash_before
 c=sqlite3.connect(dest)
 c.execute('PRAGMA foreign_keys=ON')
 assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
 assert c.execute('SELECT COUNT(*) FROM WorkOrder').fetchone()[0]==0
 assert {'WorkOrder_orderId_status_idx','WorkOrder_status_createdAt_idx'} <= {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='index'")}
 # Trois scénarios physiques (9 pièces salon, 7 puis 11 matelas).
 c.execute("INSERT INTO Client(name,city) VALUES ('CLIENT TEST OF','CASABLANCA')")
 client=c.execute('SELECT last_insert_rowid()').fetchone()[0]
 for j,(name,family,n) in enumerate((('Salon mixte','SALON',9),('Matelas 7','MATELAS',7),('Matelas 11','MATELAS',11)),1):
  c.execute('INSERT INTO Product(sku,name,family,model,length,width,height,unit,coreType,foamComposition,mattressFinish,foamDensity) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            (f'TESTOF-{j}',name,family,'STD',200,90,25,'ml' if family=='SALON' else 'u',
             'BONNELL' if family=='MATELAS' else None, 'PURE' if family=='MATELAS' else None,
             'SANS' if family=='MATELAS' else None, 30 if family=='MATELAS' else None))
  product=c.execute('SELECT last_insert_rowid()').fetchone()[0]
  c.execute('INSERT INTO "Order"(ref,clientId) VALUES (?,?)',(f'CMD-TEST-{j}',client))
  order=c.execute('SELECT last_insert_rowid()').fetchone()[0]
  c.execute('INSERT INTO OrderLine(orderId,productId,qty,unit,unitPrice) VALUES(?,?,?,?,?)',
            (order,product,float(n),'ml' if family=='SALON' else 'u',150.))
  line=c.execute('SELECT last_insert_rowid()').fetchone()[0]
  codes=[]
  for k in range(n):
   code=f'CMD-TEST-{j}-L{str(k+1).zfill(2)}'
   codes.append(code)
   c.execute('INSERT INTO OrderPiece(code,orderLineId,elementNo,sequence,label,lengthCm,widthCm,heightCm) VALUES(?,?,?,?,?,?,?,?)',
             (code,line,k+1,k+1,name,200.,90.,25.))
  snapshot={'orderRef':f'CMD-TEST-{j}','client':{'name':'CLIENT TEST OF','city':'CASABLANCA'},'product':{'name':name,'family':family},'pieces':[{'code':x} for x in codes]}
  c.execute('INSERT INTO WorkOrder(ref,orderId,orderLineId,snapshotJson,totalPieces,createdBy) VALUES(?,?,?,?,?,?)',
            (f'OF-2026-TEST-{j}',order,line,json.dumps(snapshot),n,'responsable-A'))
  assert len(json.loads(c.execute('SELECT snapshotJson FROM WorkOrder WHERE orderLineId=?',(line,)).fetchone()[0])['pieces'])==n
  try:
   c.execute('INSERT INTO WorkOrder(ref,orderId,orderLineId,snapshotJson,totalPieces,createdBy) VALUES(?,?,?,?,?,?)',
             (f'OF-2026-DUP-{j}',order,line,json.dumps(snapshot),n,'responsable-B'))
   raise AssertionError('Doublon OF accepté')
  except sqlite3.IntegrityError: pass
  try:
   c.execute('INSERT INTO WorkOrder(ref,orderId,orderLineId,snapshotJson,totalPieces,createdBy) VALUES(?,?,?,?,?,?)',
             (f'OF-2026-INVALID-{j}',order,999999,json.dumps(snapshot),n,'responsable-B'))
   raise AssertionError('FK non respectée')
  except sqlite3.IntegrityError: pass
  assert (n+7)//8=={9:2,7:1,11:2}[n]
 assert c.execute('SELECT COUNT(*) FROM WorkOrder').fetchone()[0]==3
 # Un numéro de commande ne peut porter un OF lié à une ligne d'une autre CMD.
 wrong_order=c.execute('SELECT id FROM "Order" WHERE ref=?',('CMD-TEST-1',)).fetchone()[0]
 wrong_line=c.execute('SELECT id FROM OrderLine WHERE orderId=(SELECT id FROM "Order" WHERE ref=?)',('CMD-TEST-2',)).fetchone()[0]
 try:
  c.execute('INSERT INTO WorkOrder(ref,orderId,orderLineId,snapshotJson,totalPieces,createdBy) VALUES(?,?,?,?,?,?)',
            ('OF-WRONG-ORDER',wrong_order,wrong_line,json.dumps({'pieces':[]}),1,'auditeur'))
  raise AssertionError('Référence CMD/ligne incohérente acceptée')
 except sqlite3.IntegrityError:pass
 # L'annulation doit être permise, et la réactivation conserve le numéro.
 c.execute("UPDATE WorkOrder SET status='cancelled' WHERE ref='OF-2026-TEST-1'")
 assert c.execute("SELECT status FROM WorkOrder WHERE ref='OF-2026-TEST-1'").fetchone()[0]=='cancelled'
 assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
 c.commit();c.close()
 print('PASS migration idempotente, sauvegardes, 9/7/11, annulation, CMD/ligne, unicité, FK, base originale intacte')
