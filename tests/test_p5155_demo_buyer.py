"""Lecture seule de la base de démonstration P5.15.5."""
import sqlite3
from pathlib import Path

DB=Path(__file__).resolve().parents[1]/'db/custom.db'
if not DB.exists():
 print('SKIP SQL démo : aucune base fournie dans le ZIP sans base')
 raise SystemExit(0)
conn=sqlite3.connect(f'file:{DB}?mode=ro',uri=True)
assert conn.execute('pragma integrity_check').fetchone()[0]=='ok'
assert conn.execute('pragma foreign_key_check').fetchall()==[]
rows=conn.execute('''select stockQty,isPurchasable,isManufactured,foamNature,category
from Material where minStock>0 and stockQty<minStock''').fetchall()
rupture=sum(stock<=0 and bought for stock,bought,*_ in rows)
low=sum(stock>0 and bought for stock,bought,*_ in rows)
internal=sum((not bought and made) or (cat=='Mousse' and foam=='AGGLO') for stock,bought,made,foam,cat in rows)
# AUDIT P5.15.27-A (resynchronisation, precedent AN-01..AN-06 P5.15.23) :
# la base démo a ete recreee a la P5.15.23 (CLOTURE_REPEUPLEMENT_SODEPI_20261109 :
# 82 MP, 18 fournisseurs, 218 produits, attestes par test_p51523_demo_reseed.py
# et test_p5157_monthly.py). Compteurs mesures sur la base livree : (22, 22, 7).
assert (rupture,low,internal)==(22,22,7),(rupture,low,internal)
for table in ('PurchaseRequest','SupplierOrder','SupplierConsultation'):
 assert conn.execute(f'select count(*) from "{table}"').fetchone()[0]==0,table
assert conn.execute('select count(*) from Material').fetchone()[0]==82
print('PASS base démo P5.15.23 : 82 matières, 22 ruptures achetables, 22 faibles achetables, 7 fabrications internes, zéro DA/BC')
