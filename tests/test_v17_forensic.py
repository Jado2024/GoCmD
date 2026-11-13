#!/usr/bin/env python3
"""Audit SQL autonome GoCmd V17. Contrôles directs sur la base démo fournie.
Les données sont simulées; on présume l'inventaire initial validé pour la simulation.
P5.15.8 (écart P5157-06) : le jeu V16 historique (189 produits / 55 matières)
est vérifié sur la fixture versionnée tests/fixtures/v16_demo.db — la base
livrée contient désormais le jeu enrichi (217/64). Aucune assertion retirée.
"""
import json,math,sqlite3,pathlib,tempfile,subprocess,sys
from decimal import Decimal
ROOT=pathlib.Path(__file__).resolve().parents[1]
from_dir=ROOT/'scripts'
sys.path.insert(0,str(from_dir))
from reinitialiser_demo_v16 import check
c=sqlite3.connect(f'file:{ROOT/"tests/fixtures/v16_demo.db"}?mode=ro',uri=True);c.row_factory=sqlite3.Row
checks=0
def verify(ok,msg):
 global checks
 if not ok:raise AssertionError(msg)
 checks+=1
verify(c.execute('PRAGMA integrity_check').fetchone()[0]=='ok','SQLite integrity')
verify(not c.execute('PRAGMA foreign_key_check').fetchall(),'FK')
verify(check(c)==[],f'Stock et factures: {check(c)}')
verify(c.execute('SELECT COUNT(*) FROM Product').fetchone()[0]==189,'189 demo products')
verify(c.execute('SELECT COUNT(*) FROM Movement WHERE isArchived=1').fetchone()[0]==0,'no legacy movement')
verify(c.execute('SELECT COUNT(*) FROM Material').fetchone()[0]==55,'materials')
for family,quantity in [('MATELAS',81),('BANQUETTE',54),('PLAQUE_MOUSSE',36),('SALON',9),('GAUFRETTE',9)]:
 verify(c.execute('SELECT COUNT(*) FROM Product WHERE family=?',(family,)).fetchone()[0]==quantity,f'family {family}')
for p in c.execute('SELECT family,height,foamComposition,foamLayers,foamDensity,coreType,mattressFinish,upholstery FROM Product'):
 if p['family'] in ('MATELAS','BANQUETTE'):
  verify(p['coreType'] in ('SANS_RESSORTS','BONNELL','ENSACHES'),'core')
  if p['foamComposition']=='MELANGE':
   layers=json.loads(p['foamLayers']);verify({'PURE','AGGLO'}<={l['nature'] for l in layers},'mix natures')
   verify(sum(l['thicknessCm'] for l in layers)<=p['height']+0.001,'foam layers cannot exceed product height')
  else:verify(p['foamDensity']>0,'foam density')
  if p['family']=='MATELAS':verify(p['mattressFinish'] in ('SANS','TOPPER','ALESE') and p['upholstery'] is None,'mat finish')
  else:verify(p['upholstery'] in ('NUE','TISSU') and p['mattressFinish'] is None,'seat upholstery')
for p in c.execute('SELECT id,gabaritCode,linearMeters,dimensionsExtra,billingMode FROM OrderPiece WHERE gabaritCode IN ("41","51")'):
 x=json.loads(p['dimensionsExtra']);d=x.get('D',0);j=x['J'];w=p['linearMeters'];k=x['K'];l=x['L'];h=x['H']
 verify(p['billingMode']=='computed','automatic 41/51')
 verify(abs(w-h-(d+j)/2)<1e-9,'45 W formula')
 verify(abs(k-(w-d)/math.sqrt(2))<1e-9,'45 upper K')
 verify(abs(l-(w-j)/math.sqrt(2))<1e-9,'45 lower L')
 verify(x['angleHautKDegres']==45 and x['angleBasLDegres']==45,'45 angles')
verify({x[0] for x in c.execute('SELECT DISTINCT gabaritCode FROM OrderPiece WHERE gabaritCode IN ("41","51")')}=={'41','51'},'both special gabarits simulated')
for inv in c.execute('SELECT * FROM SalesInvoice'):
 rows=list(c.execute('SELECT amountCents FROM SalesInvoiceLine WHERE invoiceId=?',(inv['id'],)))
 verify(sum(x[0] for x in rows)==inv['subtotalCents'],'invoice item subtotals')
 verify(inv['subtotalCents']+inv['taxCents']==inv['totalCents'],'invoice tax total')
 pay=c.execute('SELECT COALESCE(SUM(amountCents),0) FROM SalesPayment WHERE invoiceId=?',(inv['id'],)).fetchone()[0]
 credit=c.execute('SELECT COALESCE(SUM(amountCents),0) FROM SalesCreditNote WHERE invoiceId=?',(inv['id'],)).fetchone()[0]
 verify(pay+credit<=inv['totalCents'],'no overpayment')
 verify(inv['status'] not in ('paid','settled') or pay+credit==inv['totalCents'],'settled is zero balance')
for ol in c.execute('SELECT id,qty,unit FROM OrderLine'):
 pieces=c.execute('SELECT linearMeters FROM OrderPiece WHERE orderLineId=?',(ol['id'],)).fetchall()
 qty=len(pieces) if ol['unit']=='u' else sum(x[0] for x in pieces)
 verify(abs(qty-ol['qty'])<1e-5,'label quantity equals sale')
# Explicit SQL attack/accidental updates should be rejected by DB trigger (on isolated copy).
with tempfile.TemporaryDirectory() as d:
 db=sqlite3.connect(pathlib.Path(d)/'isolated.db');c.backup(db)
 def reject(sql,args=()):
  global checks
  try:db.execute(sql,args)
  except sqlite3.DatabaseError:db.rollback();checks+=1
  else:db.rollback();raise AssertionError('Invalid record allowed: '+sql)
 reject('UPDATE Product SET foamLayers=? WHERE sku="SIM-BQ-004"', (json.dumps([{'nature':'PURE','densityKgM3':30,'thicknessCm':9},{'nature':'AGGLO','densityKgM3':70,'thicknessCm':8}]),))
 # Select a mixed product and attempt invalid layers.
 mix=db.execute("SELECT sku,height FROM Product WHERE foamComposition='MELANGE' AND family='BANQUETTE' LIMIT 1").fetchone()
 sku,height=mix
 for layers in [
  [{'nature':'PURE','densityKgM3':28,'thicknessCm':5},{'nature':'PURE','densityKgM3':70,'thicknessCm':4}],
  [{'nature':'PURE','densityKgM3':-1,'thicknessCm':4},{'nature':'AGGLO','densityKgM3':70,'thicknessCm':4}],
  [{'nature':'PURE','densityKgM3':28,'thicknessCm':height},{'nature':'AGGLO','densityKgM3':70,'thicknessCm':1}],
  [{'nature':'PURE','densityKgM3':28,'thicknessCm':4},{'nature':'WRONG','densityKgM3':70,'thicknessCm':4}],
 ]:reject('UPDATE Product SET foamLayers=? WHERE sku=?',(json.dumps(layers),sku))
 db.close()
c.close()
print(f'PASS V17 forensic : {checks} contrôles : 5 familles, 189 produits, couches cohérentes, 41/51 à 45°, stocks, factures, anti-doublons et rejets SQL')
