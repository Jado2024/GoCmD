#!/usr/bin/env python3
"""SYNTHETIC DEMO ONLY. Cree de faux renouvellements de qualification pour tester novembre.
Ne doit jamais etre applique a une base reelle. Anciennes evaluations conservees.
"""
import argparse, sqlite3, pathlib, datetime,sys
p=argparse.ArgumentParser()
p.add_argument('--db',required=True)
p.add_argument('--apply',action='store_true')
p.add_argument('--ack',default='')
a=p.parse_args();path=pathlib.Path(a.db).resolve()
if not a.apply or a.ack!='DEMO_SYNTHETIQUE_SEULEMENT':
 print('Lecture seule. Usage: --apply --ack DEMO_SYNTHETIQUE_SEULEMENT');sys.exit(0)
with sqlite3.connect(path) as c:
 c.execute('PRAGMA foreign_keys=ON')
 mat=c.execute('SELECT count(*) FROM Material').fetchone()[0]
 sup=c.execute('SELECT count(*) FROM Supplier').fetchone()[0]
 da=c.execute('SELECT count(*) FROM PurchaseRequest').fetchone()[0]
 if (mat,sup,da)!=(64,11,0): raise RuntimeError(f'Ce script est exclusivement prevu pour la DEMO vierge (64/11/0) : {mat}/{sup}/{da}')
 now=int(datetime.datetime(2026,11,2,9,tzinfo=datetime.timezone.utc).timestamp()*1000)
 exp=int(datetime.datetime(2026,12,31,23,59,tzinfo=datetime.timezone.utc).timestamp()*1000)
 count=0
 for (id,) in c.execute('SELECT id FROM Supplier WHERE active=1').fetchall():
  latest=c.execute('SELECT status,expiresAt FROM SupplierQualification WHERE supplierId=? ORDER BY reviewedAt DESC,id DESC LIMIT 1',(id,)).fetchone()
  if not latest or latest[0]!='approved':continue
  if latest[1] is not None and latest[1]<now:
   c.execute('INSERT INTO SupplierQualification(supplierId,status,score,note,reviewedBy,reviewedAt,expiresAt) VALUES(?,?,?,?,?,?,?)',
     (id,'approved',75,'EVALUATION FICTIVE DE DEMONSTRATION : ne remplace pas qualification fournisseur reelle','demo_approver',now,exp));count+=1
 assert not c.execute('PRAGMA foreign_key_check').fetchall()
 print(f'DEMO P5.15.7 : {count} qualifications FICTIVES ajoutees, historiques conserves')
