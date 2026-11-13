#!/usr/bin/env python3
"""Vérification non destructive de la base de recette GoCmd à la DA initiale."""
import sqlite3, pathlib, argparse, sys
p=argparse.ArgumentParser();p.add_argument('--db',default='db/custom.db');args=p.parse_args()
f=pathlib.Path(args.db).resolve()
if not f.is_file():raise SystemExit(f'Base introuvable : {f}')
con=sqlite3.connect(f.as_uri()+'?mode=ro',uri=True)
try:
 def n(tab):return con.execute(f'SELECT COUNT(*) FROM "{tab}"').fetchone()[0]
 assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok','SQLite integrity_check'
 assert con.execute('PRAGMA foreign_key_check').fetchall()==[],'SQLite foreign_key_check'
 # AUDIT P5.15.27-A : reference resynchronisee sur la base demo P5.15.23
 # (CLOTURE_REPEUPLEMENT_SODEPI_20261109 : 82 MP, 18 fournisseurs, 135 liaisons,
 # 218 produits, 10 clients, 9 comptes — attestes par test_p51523_demo_reseed.py).
 expected={'Material':82,'Supplier':18,'SupplierMaterial':135,'StockLot':64,'StockPlacement':64,'Movement':64,'Product':218,'Client':10,'GoCmdUser':9,'GoCmdSession':0}
 for tab,count in expected.items():assert n(tab)==count,f'{tab}: attendu {count}, obtenu {n(tab)}'
 transactions=['PurchaseRequest','PurchaseRequestLine','SupplierConsultation','SupplierQuoteOffer','SupplierOrder','SupplierOrderLine','GoodsReceipt','GoodsReceiptLine','Order','OrderLine','SalesQuote','SalesInvoice','SalesPayment','SalesDelivery']
 for tab in transactions:assert n(tab)==0,f'{tab}: {n(tab)} anciennes transactions'
 assert con.execute('SELECT COUNT(*) FROM Material WHERE stockQty <= 0').fetchone()[0]==32
 assert con.execute("""SELECT COUNT(*) FROM Material m LEFT JOIN (SELECT materialId, SUM(qty) q FROM StockLot WHERE status='available' GROUP BY materialId) l ON l.materialId=m.id WHERE ABS(m.stockQty-COALESCE(l.q,0))>0.000001""").fetchone()[0]==0,'Stock matière != lots'
 assert con.execute("""SELECT COUNT(*) FROM StockLot l LEFT JOIN (SELECT stockLotId,SUM(qty) q FROM StockPlacement GROUP BY stockLotId) p ON p.stockLotId=l.id WHERE ABS(l.qty-COALESCE(p.q,0))>0.000001""").fetchone()[0]==0,'Lot != emplacement'
 assert con.execute("""SELECT COUNT(*) FROM Material m LEFT JOIN (SELECT materialId,SUM(signedQty) q FROM Movement WHERE isOpeningBalance=1 GROUP BY materialId) h ON h.materialId=m.id WHERE ABS(m.stockQty-COALESCE(h.q,0))>0.000001""").fetchone()[0]==0,'Ouverture != stock'
 assert con.execute('SELECT COUNT(*) FROM GoCmdUser WHERE must_change_password=1 AND active=1').fetchone()[0]==9,'Première connexion sans renouvellement forcé'
 # V2 recodification (audit R9 indépendant) : l'exemple de rupture initiale porte
 # désormais la référence codifiée V2 de la colle agglomérée (fût 25 kg).
 assert con.execute("SELECT COUNT(*) FROM Material WHERE ref='MP-COL-CHAQU-GRAGGLO-CONDFUT-CAPKG25' AND stockQty=0 AND minStock=60").fetchone()[0]==1,'Exemple de rupture initiale absent'
 assert con.execute("SELECT COUNT(*) FROM Movement WHERE isOpeningBalance<>1").fetchone()[0]==0,'Mouvements anciens'
 print('PASS GoCmd démo P5.15.23 : 82 matières / 18 fournisseurs / 64 lots / 9 comptes / zéro DA, BC, BR ; stocks et FK cohérents')
finally:con.close()
