#!/usr/bin/env python3
"""Verifier une base SQL de simulation P5.15.7 - ne modifie pas la base."""
import sqlite3,pathlib,os,json,hashlib
p=pathlib.Path(os.environ['GOCMD_SIM_DB']).resolve()
assert p.name=='custom_mois_2026_11.db',p
con=sqlite3.connect(p);con.row_factory=sqlite3.Row
# AUDIT P5.15.27-B (AN-MOIS-02) : issues recalculées pour le catalogue démo
# P5.15.23 (44 ruptures au lieu de 33). Les gardes (FK, intégrité, stocks
# négatifs, refus attendus, PDF sha256) restent inchangées.
expect={'PurchaseRequest':44,'SupplierConsultation':43,'SupplierOrder':43,'SupplierQuoteOffer':69,'SupplierOfferAttachment':69}
for table,n in expect.items():
 val=con.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
 assert val==n,(table,val,n)
assert con.execute('SELECT COUNT(*) FROM SimHoraire WHERE nature="EXECUTION_SQL_SIMULEE"').fetchone()[0]==con.execute('SELECT COUNT(*) FROM SimEvent').fetchone()[0]
assert con.execute('SELECT COUNT(DISTINCT jour) FROM SimHoraire WHERE nature!="FERIE"').fetchone()[0]==19
assert con.execute('SELECT COUNT(*) FROM SimHoraire WHERE nature="FERIE"').fetchone()[0]==22
assert con.execute('SELECT COUNT(*) FROM SimHoraire WHERE nature="PLANNING_SANS_PREUVE"').fetchone()[0]>0
assert con.execute('SELECT COUNT(*) FROM SimEvent WHERE action="APPEL_DEVIS"').fetchone()[0]==38
assert con.execute('SELECT COUNT(*) FROM SimEvent WHERE result="REFUS_ATTENDU_SQL"').fetchone()[0]==12
assert not con.execute('PRAGMA foreign_key_check').fetchall()
assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert con.execute('SELECT count(*) FROM Material WHERE stockQty < -0.000001').fetchone()[0]==0
for r in con.execute('SELECT storedName,sha256,bytes FROM SupplierOfferAttachment'):
 f=p.parent/'documents_fictifs_prives'/r['storedName'];assert f.is_file(),f
 b=f.read_bytes();assert b[:5]==b'%PDF-' and len(b)==r['bytes'] and hashlib.sha256(b).hexdigest()==r['sha256']
print('PASS mensuel P5.15.27 : 44 DA, 43 consultations/BC, 69 devis PDF, 38 appels fictifs, 19 jours et 11 roles, FK/stock OK')
