"""Vérifie la migration additive sur une copie temporaire de la DB de démonstration."""
from pathlib import Path
import sqlite3
import tempfile
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from upgrade_phone_offers_p51515 import upgrade,COLUMNS
base=Path(__file__).resolve().parents[1]/'db/custom.db'
assert base.is_file(),'fixture démo manquante'
with tempfile.TemporaryDirectory() as d:
    target=Path(d)/'copy.db'
    original=sqlite3.connect(base)
    copied=sqlite3.connect(target)
    original.backup(copied)
    original.close();copied.close()
    con=sqlite3.connect(target)
    before=con.execute('SELECT COUNT(*) FROM SupplierQuoteOffer').fetchone()[0]
    con.close()
    upgrade(target);upgrade(target)
    con=sqlite3.connect(target)
    assert set(COLUMNS).issubset({r[1] for r in con.execute('PRAGMA table_info(SupplierQuoteOffer)')})
    assert before==con.execute('SELECT COUNT(*) FROM SupplierQuoteOffer').fetchone()[0]
    assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    con.close()
print('PASS P5.15.15 : migration deux fois sur base isolée sans perte')
