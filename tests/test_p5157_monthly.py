"""Garde de livraison P5.15.7: contrat DB reel et presence de la recette rejouable."""
import sqlite3,pathlib,datetime as dt
r=pathlib.Path(__file__).resolve().parents[1]
c=sqlite3.connect(r/'db/custom.db')
# Base de démonstration P5.15.23 : 82 matières et 18 fournisseurs,
# réinitialisation sécurisée ; aucune donnée transactionnelle initiale.
assert c.execute('select count(*) from Material').fetchone()[0]==82
assert c.execute('select count(*) from Supplier').fetchone()[0]==18
assert c.execute('select count(*) from PurchaseRequest').fetchone()[0]==0
assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
assert not c.execute('pragma foreign_key_check').fetchall()
required={'approvedQty','approvalDecision','approvalReason','decisionBy','decisionAt'}
assert required.issubset({x[1] for x in c.execute('pragma table_info(PurchaseRequestLine)')})
qual=c.execute("SELECT count(*) FROM SupplierQualification q WHERE q.note LIKE 'EVALUATION FICTIVE DE DEMONSTRATION%' ").fetchone()[0]
assert qual==7,qual
for item in ['create_demo_users.cjs','simulate_month.py','etendre_simulation_horaire.py']:
 assert (r/'QA_P5157_MOIS'/item).exists()
assert 'check_sqlite_schema_p5157.py' in (r/'scripts/start-gocmd-checked.cjs').read_text()
print('PASS P5.15.7 : schema complet, 7 qualifications fictives, 82 matieres (réf. P5.15.23), aucune DA, simulateurs rejouables, SQLite/FK OK')
