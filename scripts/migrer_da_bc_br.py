#!/usr/bin/env python3
"""Migration additive DA/BC/BR avec sauvegarde. Ne modifie pas les commandes et les produits."""
import argparse
import datetime
import pathlib
import re
import shutil
import sqlite3

DDL = '''
CREATE TABLE IF NOT EXISTS Supplier (
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE,
 phone TEXT, email TEXT, address TEXT, active BOOLEAN NOT NULL DEFAULT 1,
 createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS SupplierMaterial (
 id INTEGER PRIMARY KEY AUTOINCREMENT, supplierId INTEGER NOT NULL, materialId INTEGER NOT NULL,
 supplierSku TEXT, unitPrice REAL, leadTimeDays INTEGER, preferred BOOLEAN NOT NULL DEFAULT 0,
 FOREIGN KEY(supplierId) REFERENCES Supplier(id), FOREIGN KEY(materialId) REFERENCES Material(id),
 UNIQUE(supplierId, materialId)
);
CREATE INDEX IF NOT EXISTS SupplierMaterial_materialId_idx ON SupplierMaterial(materialId);
CREATE TABLE IF NOT EXISTS SupplierOrder (
 id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE, supplierId INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'confirmed', expectedDate DATETIME, note TEXT,
 createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, closedAt DATETIME, closedReason TEXT,
 FOREIGN KEY(supplierId) REFERENCES Supplier(id)
);
CREATE INDEX IF NOT EXISTS SupplierOrder_supplierId_status_idx ON SupplierOrder(supplierId,status);
CREATE TABLE IF NOT EXISTS SupplierOrderLine (
 id INTEGER PRIMARY KEY AUTOINCREMENT, orderId INTEGER NOT NULL, materialId INTEGER NOT NULL,
 requestLineId INTEGER, qty REAL NOT NULL, receivedQty REAL NOT NULL DEFAULT 0, unitPrice REAL NOT NULL,
 FOREIGN KEY(orderId) REFERENCES SupplierOrder(id) ON DELETE CASCADE,
 FOREIGN KEY(materialId) REFERENCES Material(id),
 FOREIGN KEY(requestLineId) REFERENCES PurchaseRequestLine(id)
);
CREATE INDEX IF NOT EXISTS SupplierOrderLine_requestLineId_idx ON SupplierOrderLine(requestLineId);
CREATE INDEX IF NOT EXISTS SupplierOrderLine_materialId_idx ON SupplierOrderLine(materialId);
CREATE TABLE IF NOT EXISTS GoodsReceipt (
 id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE,
 supplierOrderId INTEGER NOT NULL, deliveryRef TEXT NOT NULL, operator TEXT NOT NULL,
 note TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(supplierOrderId) REFERENCES SupplierOrder(id),
 UNIQUE(supplierOrderId,deliveryRef)
);
CREATE INDEX IF NOT EXISTS GoodsReceipt_createdAt_idx ON GoodsReceipt(createdAt);
CREATE TABLE IF NOT EXISTS GoodsReceiptLine (
 id INTEGER PRIMARY KEY AUTOINCREMENT, goodsReceiptId INTEGER NOT NULL,
 supplierOrderLineId INTEGER NOT NULL, acceptedQty REAL NOT NULL,
 rejectedQty REAL NOT NULL DEFAULT 0, lot TEXT, movementId INTEGER UNIQUE,
 FOREIGN KEY(goodsReceiptId) REFERENCES GoodsReceipt(id) ON DELETE CASCADE,
 FOREIGN KEY(supplierOrderLineId) REFERENCES SupplierOrderLine(id),
 FOREIGN KEY(movementId) REFERENCES Movement(id),
 UNIQUE(goodsReceiptId,supplierOrderLineId)
);
'''

def migrate(path, backup=True):
    path=pathlib.Path(path).resolve()
    if not path.is_file(): raise SystemExit('Base introuvable : '+str(path))
    if backup:
        target=path.with_name(path.stem+'.avant_da_bc_br_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S')+path.suffix)
        shutil.copy2(path,target)
        print('Sauvegarde :',target)
    con=sqlite3.connect(path, timeout=20)
    con.execute('PRAGMA foreign_keys=ON')
    try:
        with con:
            con.executescript(DDL)
            for name,mid,unit_price in con.execute('SELECT DISTINCT TRIM(supplier),MIN(id),MAX(unitPrice) FROM Material WHERE supplier IS NOT NULL AND TRIM(supplier) != "" GROUP BY TRIM(supplier)').fetchall():
                # Fournisseurs existants créés une fois ; aucun fournisseur supplémentaire inventé.
                exists=con.execute('SELECT id FROM Supplier WHERE name=?',(name,)).fetchone()
                if exists: continue
                next_id=con.execute('SELECT COALESCE(MAX(id),0)+1 FROM Supplier').fetchone()[0]
                con.execute('INSERT INTO Supplier(code,name) VALUES (?,?)',(f'FRN-{next_id:04d}',name))
            for mid,supplier,price in con.execute('SELECT id,TRIM(supplier),unitPrice FROM Material WHERE supplier IS NOT NULL AND TRIM(supplier) != ""').fetchall():
                sid=con.execute('SELECT id FROM Supplier WHERE name=?',(supplier,)).fetchone()[0]
                con.execute('INSERT OR IGNORE INTO SupplierMaterial(supplierId,materialId,unitPrice,preferred) VALUES (?,?,?,1)',(sid,mid,price))
        check=con.execute('PRAGMA integrity_check').fetchone()[0]
        if check!='ok':raise RuntimeError(check)
        print('Migration OK, fournisseurs :',con.execute('SELECT count(*) FROM Supplier').fetchone()[0])
        print('BC :',con.execute('SELECT count(*) FROM SupplierOrder').fetchone()[0], 'BR :',con.execute('SELECT count(*) FROM GoodsReceipt').fetchone()[0])
    finally:con.close()

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--db',default=str(pathlib.Path(__file__).resolve().parent.parent/'db'/'custom.db'))
    p.add_argument('--no-backup',action='store_true')
    a=p.parse_args()
    migrate(a.db,not a.no_backup)
