"""Recette isolée et idempotente : aucune modification de db/custom.db."""
import importlib.util
from pathlib import Path
import tempfile
import sqlite3
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('upgrade_suppliers_p510',ROOT/'scripts'/'upgrade_suppliers_p510.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='gocmd-p510-') as folder:
    db=Path(folder)/'test.db'
    con=sqlite3.connect(db)
    con.executescript('CREATE TABLE Supplier(id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT UNIQUE, phone TEXT, email TEXT, address TEXT, active BOOLEAN NOT NULL DEFAULT 1, createdAt TEXT); '
                      "INSERT INTO Supplier(id,code,name,phone,email,address,active,createdAt) VALUES(1,'FRN-0001','Atlas Foam','555','contact@example.test','Casablanca',1,'2026-10-30');")
    con.commit();con.close()
    module.upgrade(db)
    module.upgrade(db)
    con=sqlite3.connect(db)
    assert con.execute('SELECT COUNT(*) FROM Supplier').fetchone()[0]==1
    columns={c[1] for c in con.execute('PRAGMA table_info(Supplier)')}
    assert set(module.COLUMNS)<=columns
    assert con.execute('SELECT name,phone,email,address FROM Supplier WHERE id=1').fetchone()==('Atlas Foam','555','contact@example.test','Casablanca')
    assert con.execute('SELECT city,country,ice,taxId,tradeRegister,paymentTerms FROM Supplier WHERE id=1').fetchone()==(None,)*6
    con.execute("UPDATE Supplier SET city='Mohammedia', country='Maroc', ice='EXEMPLE' WHERE id=1")
    con.commit();con.close()
    module.upgrade(db)
    con=sqlite3.connect(db)
    assert con.execute('SELECT city,country,ice FROM Supplier WHERE id=1').fetchone()==('Mohammedia','Maroc','EXEMPLE')
    assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    con.close()
print('PASS P5.10 : migration SQL additive, rejouable, sans perte de fournisseurs ni modification des fiches existantes')
