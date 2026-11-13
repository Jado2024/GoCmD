import sys,tempfile,shutil,sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from upgrade_sourcing_p511 import upgrade
with tempfile.TemporaryDirectory() as tmp:
    db=Path(tmp)/'copy.db'
    shutil.copy2(ROOT/'db'/'custom.db',db)
    con=sqlite3.connect(db)
    counts={x:con.execute(f'SELECT COUNT(*) FROM "{x}"').fetchone()[0] for x in ['Supplier','Material','SupplierQuoteOffer','SupplierOrderLine']}
    con.close()
    upgrade(db)
    upgrade(db)
    con=sqlite3.connect(db)
    for table,n in counts.items():assert con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]==n
    assert con.execute('SELECT COUNT(*) FROM SupplierPriceAgreement').fetchone()[0]==0
    for field in ['priceSourceType','priceSourceId','priceSourceRef']:
        assert field in {v[1] for v in con.execute('PRAGMA table_info(SupplierOrderLine)')}
    for field in ['quoteRef','validUntil','documentRef']:
        assert field in {v[1] for v in con.execute('PRAGMA table_info(SupplierQuoteOffer)')}
    assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not con.execute('PRAGMA foreign_key_check').fetchall()
    con.close()
print('PASS P5.11 : migration additive, idempotente, conservation des enregistrements et intégrité SQLite')
