import tempfile,shutil,sqlite3,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as d:
    db=Path(d)/'demo.db';shutil.copy2(root/'db'/'custom.db',db)
    def counts():
        c=sqlite3.connect(db)
        try:return [c.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in ('Material','Supplier','PurchaseRequest','SupplierRFQ')]
        finally:c.close()
    before=counts()
    for _ in range(2):
        r=subprocess.run([sys.executable,str(root/'scripts/upgrade_consultations_p512.py'),'--db',str(db),'--apply'],capture_output=True,text=True)
        assert r.returncode==0,r.stdout+'\n'+r.stderr
        assert counts()==before
    c=sqlite3.connect(db);c.execute('PRAGMA foreign_keys=ON')
    for t in ('SupplierConsultation','SupplierConsultationLine','SupplierConsultationRecipient','SupplierConsultationRecipientLine'):
        assert c.execute('SELECT 1 FROM sqlite_master WHERE type="table" AND name=?',(t,)).fetchone()
    assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not c.execute('PRAGMA foreign_key_check').fetchall()
    c.close()
print('PASS P5.12 : migration 2x, tables / index, historique conservé, SQLite intact')
