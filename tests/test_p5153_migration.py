#!/usr/bin/env python3
"""Test indépendant migration additive et anti-régression sans modification de la démo originale."""
import pathlib, sqlite3, tempfile, shutil, subprocess, sys
root=pathlib.Path(__file__).resolve().parents[1]
src=root/'db/custom.db'
with tempfile.TemporaryDirectory(prefix='gocmd_p5153_') as td:
 p=pathlib.Path(td);db=p/'work'/'test.db';db.parent.mkdir()
 shutil.copy2(src,db)
 def snapshot():
  with sqlite3.connect(db) as c:
   tables=['Material','Product','OrderLine','StockLot','Movement','SalesDeliveryLine']
   return {t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in tables}
 old=snapshot()
 cmd=[sys.executable,str(root/'scripts/upgrade_article_trade_p5153.py'),'--db',str(db)]
 dry=subprocess.run(cmd,text=True,capture_output=True)
 assert dry.returncode==0,dry.stderr
 # Accepte comme fixture une base P5.15.2 non migrée OU la démonstration P5.15.3 déjà migrée.
 with sqlite3.connect(db) as c:
  originally_migrated='isSellable' in [x[1] for x in c.execute('PRAGMA table_info(Material)')]
 applied=subprocess.run([*cmd,'--apply','--backup',str(p/'backups'/'prior.db')],text=True,capture_output=True)
 assert applied.returncode==0,applied.stderr
 assert (p/'backups'/'prior.db').is_file()
 assert snapshot()==old,(old,snapshot())
 with sqlite3.connect(db) as c:
  assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
  assert not c.execute('PRAGMA foreign_key_check').fetchall()
  assert {'isPurchasable','isSellable','salesUnit','unitsPerSale','salesUnitPrice'} <= {x[1] for x in c.execute('PRAGMA table_info(Material)')}
  assert {'stockUnit','stockUnitsPerSale'}<={x[1] for x in c.execute('PRAGMA table_info(OrderLine)')}
  assert c.execute("select count(*) from Material where category='Mousse' and foamNature='AGGLO' and isPurchasable=1").fetchone()[0]==0
  assert c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='SalesStockAllocation'").fetchone()[0]==1
  # Vérifie sur une matière NON DEJA liée : le jeu de données enrichi a ses propres produits de négoce.
  # Vérifie qu'une fiche métier de négoce peut réellement référencer Material.
  # La copie de test est jetée après validation.
  m=c.execute('''SELECT m.id,m.ref,m.name,m.unit FROM Material m LEFT JOIN Product p ON p.materialId=m.id WHERE p.id IS NULL ORDER BY m.id LIMIT 1''').fetchone()
  if m:
   cur=c.execute('INSERT INTO Product (sku,name,family,model,variant,length,width,height,unit,unitPrice,materialId) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ('TEST-N3-TRADE','Article de test','NEGOCE','Essai','STD',1,1,1,m[3],20,m[0]))
   assert c.execute('SELECT materialId FROM Product WHERE id=?',(cur.lastrowid,)).fetchone()[0]==m[0]
   c.rollback()
 second=subprocess.run([*cmd,'--apply','--backup',str(p/'backups'/'second.db')],text=True,capture_output=True)
 assert second.returncode==0,second.stderr
 assert snapshot()==old
 print('PASS P5.15.3: dry-run, sauvegarde, migration, intégrité, anti-perte, relation, idempotence, fixture déjà migrée='+str(originally_migrated))
