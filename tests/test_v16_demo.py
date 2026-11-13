#!/usr/bin/env python3
"""Tests de recette SQL V16 sur la fixture versionnée + réinitialisation sur copie temporaire.

P5.15.8 (écart P5157-06) : la base de démonstration livrée avec le projet est
désormais le jeu enrichi (217 produits / 64 matières / 11 fournisseurs), qui
change les effectifs historiques du jeu V16 (189 / 55 / 7). Le contrat du jeu
V16 reste valide et doit continuer d'être vérifié : il s'exécute désormais sur
une fixture figée `tests/fixtures/v16_demo.db` (instantané du jeu V16 validé,
SHA-256 enregistré ci-dessous ; migration additive P5.15.0 des décisions
de lignes DA appliquée pour rester compatible avec le schéma serveur) au
lieu de la base live. Aucune assertion n'a
été supprimée ni affaiblie ; seule la source des données change.
La réinitialisation de démonstration reste testée sur copie temporaire et ne
modifie jamais la base livrée.
"""
import sys,sqlite3,subprocess,tempfile,pathlib,json,collections,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from reinitialiser_demo_v16 import check
FIXTURE=ROOT/'tests/fixtures/v16_demo.db'
FIXTURE_SHA256='002756607bf36f19ebd6fd3c1124b8189fd406a78d4fa8579d0b71495188987f'
_h=hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
assert _h==FIXTURE_SHA256,f'Fixture V16 modifiée ou corrompue (SHA-256 {_h}) : restaurer tests/fixtures/v16_demo.db depuis la livraison.'
c=sqlite3.connect(f'file:{FIXTURE}?mode=ro',uri=True);c.row_factory=sqlite3.Row
one=lambda sql: c.execute(sql).fetchone()[0]
counts={r['family']:r['cnt'] for r in c.execute('SELECT family,count(*) cnt FROM Product GROUP BY family')}
assert counts=={'MATELAS':81,'BANQUETTE':54,'PLAQUE_MOUSSE':36,'SALON':9,'GAUFRETTE':9},counts
assert one('SELECT COUNT(*) FROM Product')==189
assert one('SELECT COUNT(*) FROM Material')==55
assert one('SELECT COUNT(*) FROM Client')==10
assert one('SELECT COUNT(*) FROM Supplier')==7
assert one('SELECT COUNT(DISTINCT coreType||"/"||foamComposition) FROM Product WHERE family="MATELAS"')==9
assert one('SELECT COUNT(DISTINCT coreType||"/"||foamComposition) FROM Product WHERE family="BANQUETTE"')==9
assert one('SELECT COUNT(*) FROM Product WHERE family="MATELAS" AND mattressFinish NOT IN ("SANS","TOPPER","ALESE")')==0
assert one('SELECT COUNT(*) FROM Product WHERE family="BANQUETTE" AND upholstery NOT IN ("NUE","TISSU")')==0
assert one('SELECT COUNT(*) FROM Product WHERE family="PLAQUE_MOUSSE" AND (foamNature NOT IN ("PURE","AGGLO") OR foamDensity IS NULL OR foamGrade IS NULL)')==0
for x in c.execute('SELECT foamComposition,foamLayers,foamDensity,foamNature,coreType,family,unit FROM Product'):
 if x['family'] in ('MATELAS','BANQUETTE'):
  assert x['coreType'] in ('SANS_RESSORTS','BONNELL','ENSACHES')
  assert x['foamComposition'] in ('PURE','MELANGE','AGGLO')
  if x['foamComposition']=='MELANGE':
   layers=json.loads(x['foamLayers']);assert {'PURE','AGGLO'}<={y['nature'] for y in layers};assert x['foamDensity'] is None
  else:assert x['foamDensity']>0 and x['foamLayers'] is None
 assert x['unit']==('u' if x['family'] in ('MATELAS','PLAQUE_MOUSSE') else 'ml')
expected={'Movement':63,'Order':5,'OrderLine':5,'OrderPiece':13,'PurchaseRequest':4,'SupplierOrder':4,
          'GoodsReceipt':4,'SupplierInvoice':4,'SalesQuote':7,'SalesDelivery':5,'SalesInvoice':4,
          'SalesPayment':4,'SupplierPayment':3,'SupplierReturn':1,'QualityInspection':1,'SupplierRFQ':1,'AuditEvent':144}
for t,n in expected.items():assert one(f'SELECT COUNT(*) FROM "{t}"')==n,(t,one(f'SELECT COUNT(*) FROM "{t}"'),n)
assert {x[0] for x in c.execute('SELECT DISTINCT p.family FROM OrderLine l JOIN Product p ON p.id=l.productId')}==set(counts)
assert one('SELECT COUNT(*) FROM Movement WHERE isArchived=1')==0
assert one('SELECT COUNT(*) FROM Movement WHERE isOpeningBalance=1')==55
assert one('SELECT COUNT(*) FROM StockLot WHERE status="legacy_unverified"')==0
assert check(c)==[],check(c)
with tempfile.TemporaryDirectory() as d:
 temp=pathlib.Path(d)/'copy.db';w=sqlite3.connect(temp);c.backup(w);w.row_factory=sqlite3.Row
 assert w.execute('SELECT COUNT(*) FROM sqlite_master WHERE type="trigger" AND name LIKE "go_v16_product_%"').fetchone()[0]==2
 # Tests négatifs (API + triggers): refuser incohérences sans altérer les données.
 def blocked(query,vals=()):
  try:w.execute(query,vals);raise AssertionError('Produit incohérent accepté')
  except sqlite3.IntegrityError:w.rollback()
 blocked('UPDATE Product SET mattressFinish="TOPPER",upholstery="TISSU" WHERE sku="SIM-MAT-001"')
 blocked('UPDATE Product SET mattressFinish="TOPPER" WHERE sku="SIM-BQ-001"')
 blocked('UPDATE Product SET foamComposition="MELANGE",foamLayers=NULL WHERE sku="SIM-MAT-001"')
 blocked('UPDATE Product SET foamNature="SANS" WHERE sku="SIM-PLA-001"')
 blocked('UPDATE Product SET unit="ml" WHERE sku="SIM-PLA-001"')
 blocked('UPDATE Product SET foamDensity=-10 WHERE sku="SIM-PLA-001"')
 blocked('UPDATE Product SET coreType="BONNELL" WHERE sku="SIM-GAU-001"')
 w.close()
 cmd=[sys.executable,str(ROOT/'scripts/reinitialiser_demo_v16.py'),'--apply','--ack','DEMO_ONLY','--db',str(temp)]
 r=subprocess.run(cmd,capture_output=True,text=True)
 assert r.returncode==0,(r.stdout,r.stderr)
 w=sqlite3.connect(temp);w.row_factory=sqlite3.Row
 assert check(w)==[],check(w)
 for t,n in expected.items():assert w.execute('SELECT COUNT(*) FROM "'+t+'"').fetchone()[0]==n,t
 assert w.execute('SELECT COUNT(*) FROM Product').fetchone()[0]==189
 a=[tuple(x) for x in w.execute('SELECT ref,round(stockQty,5) FROM Material ORDER BY ref')]
 b=[tuple(x) for x in c.execute('SELECT ref,round(stockQty,5) FROM Material ORDER BY ref')]
 assert a==b
 w.close()
c.close()
print('PASS V16 (fixture versionnée) : 189 produits / 5 familles / 9 combinaisons matelas+banquette / 36 plaques, 4 DA->BC->BR->facture, 5 commandes, 7 devis, 55 stocks reconciliés, 7 rejets SQL, re-seed idempotent.')
