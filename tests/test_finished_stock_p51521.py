"""VEN-01 — vérification de la migration et des contraintes SQLite sur base isolée."""
import importlib.util
from pathlib import Path
import sqlite3, tempfile
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fg',ROOT/'scripts/upgrade_finished_stock_p51521.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
with tempfile.TemporaryDirectory() as temp:
    db=Path(temp)/'demo.db'
    with sqlite3.connect(db) as con:
        con.executescript('''PRAGMA foreign_keys=ON;
          CREATE TABLE Product(id INTEGER PRIMARY KEY);
          CREATE TABLE SalesDeliveryLine(id INTEGER PRIMARY KEY);
          CREATE TABLE SalesDocCounter(id TEXT PRIMARY KEY,value INTEGER NOT NULL);
          CREATE TABLE AuditEvent(id INTEGER PRIMARY KEY);
          INSERT INTO Product VALUES (1);
          INSERT INTO SalesDeliveryLine VALUES (11);''')
    assert mod.migrate(db)==True
    with sqlite3.connect(db) as con:
        assert not any(con.execute('SELECT 1 FROM sqlite_master WHERE name=?',(table,)).fetchone() for table in mod.TABLES)
    assert mod.migrate(db,True)==True
    assert mod.migrate(db,True)==False
    with sqlite3.connect(db) as con:
        con.execute('PRAGMA foreign_keys=ON')
        con.execute('INSERT INTO FinishedStockLot(productId,lotCode,qty,sourceRef,receivedBy) VALUES (1,?,7,?,?)',('MAT-0001','OF-001','magasin'))
        lot=con.execute('SELECT id FROM FinishedStockLot').fetchone()[0]
        try:
            con.execute('INSERT INTO FinishedStockLot(productId,lotCode,qty,sourceRef,receivedBy) VALUES(1,?,7,?,?)',('MAT-0001','OF-002','magasin'))
            raise AssertionError('Lot doublon permis')
        except sqlite3.IntegrityError:pass
        try:
            con.execute('UPDATE FinishedStockLot SET qty=-1 WHERE id=?',(lot,))
            raise AssertionError('Stock négatif permis')
        except sqlite3.IntegrityError:pass
        con.execute('UPDATE FinishedStockLot SET status="available",qualityBy="qualité" WHERE id=?',(lot,))
        con.execute('UPDATE FinishedStockLot SET qty=qty-4 WHERE id=? AND qty>=4',(lot,))
        con.execute('INSERT INTO FinishedStockAllocation(deliveryLineId,lotId,qty) VALUES (11,?,4)',(lot,))
        con.execute('INSERT INTO FinishedStockMovement(ref,lotId,type,qty,document,actor) VALUES (?,?,?,?,?,?)',('MFP-1',lot,'out',-4,'BL-1','magasin'))
        assert con.execute('SELECT qty FROM FinishedStockLot').fetchone()[0]==3
        assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
        assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert len(list(Path(temp).glob('*.avant_stock_fini_*.db')))==1
print('PASS VEN-01: schéma stock fini, sauvegarde, idempotence, non-négativité, doublons, allocations')
