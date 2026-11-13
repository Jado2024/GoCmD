"""Migration sur une copie temporaire, Windows : le contexte ferme les handles SQLite avant effacement."""
import sqlite3,tempfile,shutil
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('upgrade_procurement_p513',Path(__file__).resolve().parents[1]/'scripts/upgrade_procurement_p513.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
upgrade=mod.upgrade
source=Path(__file__).resolve().parents[1]/'db/custom.db'
with tempfile.TemporaryDirectory() as temp:
 file=Path(temp)/'demo.db'
 shutil.copy2(source,file)
 con=sqlite3.connect(file)
 before={t:con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in ['Supplier','Material','PurchaseRequest','SupplierRFQ','SupplierQuoteOffer','SupplierOrder']}
 con.close()
 upgrade(file);upgrade(file)
 con=sqlite3.connect(file)
 after={t:con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in before}
 assert before==after,(before,after)
 cols={r[1] for r in con.execute('PRAGMA table_info("SupplierQuoteOffer")')}
 assert {'responseChannel','confirmationStatus','contactName','callSummary','respondedAt'}<=cols
 assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
 # Historical quotes must remain confirmed, never automatically become oral.
 assert con.execute("SELECT count(*) FROM SupplierQuoteOffer WHERE confirmationStatus<>'confirmed'").fetchone()[0]==0
 con.close()
print('PASS P5.13 : migration additive, 2 exécutions, aucune suppression')
