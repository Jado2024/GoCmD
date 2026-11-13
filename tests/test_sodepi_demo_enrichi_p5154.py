"""Recette données P5.15.4 / SODEPI : contrôles réels sur base SQLite, sans serveur HTTP."""
from pathlib import Path
from contextlib import closing
import sqlite3, sys, json, tempfile, shutil
ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'db'/'custom.db'
with closing(sqlite3.connect(f'file:{DB}?mode=ro',uri=True)) as db:
    db.execute('PRAGMA foreign_keys=ON')
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    stats={key:db.execute(query).fetchone()[0] for key,query in {
        'materials':'select count(*) from Material',
        'sellable':'select count(*) from Material where isSellable=1',
        'not_sellable':'select count(*) from Material where isSellable=0',
        'manufactured':'select count(*) from Material where isManufactured=1',
        'tradeProducts':'select count(*) from Product where materialId is not null',
        'lots':'select count(*) from StockLot',
        'links':'select count(*) from SupplierMaterial',
        'outOfStock':'select count(*) from Material where stockQty=0',
        'low':'select count(*) from Material where stockQty<minStock',
    }.items()}
    assert stats['materials']==64, stats
    assert stats['sellable']==stats['tradeProducts']==28,stats
    assert stats['manufactured']==12,stats
    assert stats['outOfStock']>=15 and stats['low']>=15 and stats['links']>=70,stats
    assert db.execute('select count(*) from PurchaseRequest').fetchone()[0]==0
    assert db.execute('select count(*) from SupplierOrder').fetchone()[0]==0
    assert db.execute('select count(*) from GoodsReceipt').fetchone()[0]==0
    assert db.execute('select count(*) from Product where materialId is null').fetchone()[0]==189
    # All stock has a lot + location; each opening lot has a movement, not a simulated BR.
    assert not db.execute('''SELECT m.ref FROM Material m LEFT JOIN StockLot l ON m.id=l.materialId GROUP BY m.id
      HAVING ABS(m.stockQty-COALESCE(SUM(CASE WHEN l.status='available' THEN l.qty ELSE 0 END),0))>0.000001''').fetchall()
    assert not db.execute('''SELECT l.id FROM StockLot l LEFT JOIN StockPlacement p ON p.stockLotId=l.id GROUP BY l.id
      HAVING ABS(l.qty-COALESCE(SUM(p.qty),0))>0.000001''').fetchall()
    assert db.execute('select count(*) from Movement where isOpeningBalance=1').fetchone()[0]==stats['lots']
    # Cross-catalogue: exactly one commercial product sharing ref and sales price per sellable material.
    assert not db.execute('''SELECT m.id FROM Material m LEFT JOIN Product p ON p.materialId=m.id
      WHERE (m.isSellable=1 AND (p.id IS NULL OR p.sku!=m.ref OR p.unitPrice!=m.salesUnitPrice
           OR p.unitsPerSale!=m.unitsPerSale OR p.unit!=m.salesUnit))
         OR (m.isSellable=0 AND p.id IS NOT NULL)''').fetchall()
    assert not db.execute('select id from Material where isPurchasable=0 and isManufactured=0').fetchall()
    assert not db.execute('select id from Material where foamNature="AGGLO" and isPurchasable=1').fetchall()
    assert not db.execute('select id from Material where isManufactured=1 and EXISTS(select 1 from SupplierMaterial where materialId=Material.id)').fetchall()
    assert not db.execute('select id from Material where isSellable=1 and salesUnitPrice<=0').fetchall()
    assert not db.execute('select id from Material where isSellable=1 and isPurchasable=1 and ABS(unitPrice-salesUnitPrice)<0.000001').fetchall()
    for nature, fmt in db.execute('select foamNature,foamFormat from Material where category="Mousse"'):
        assert nature in ('PURE','AGGLO') and fmt in ('BLOC','PLAQUE','ROULEAU')
        assert not (nature=='AGGLO' and fmt=='ROULEAU')
    assert db.execute("select count(*) from SupplierMaterial sm join Material m on m.id=sm.materialId where m.category='Tissu' and m.unit='ml' and sm.purchaseUnit='rouleau' and sm.unitsPerPurchase=50").fetchone()[0]>=9
    # Key demo references exist and are visible in both inventories.
    assert db.execute("select count(*) from Material where ref like 'MP-MOU-PUR-STD-D33-%' and isSellable=1 and unit='bloc'").fetchone()[0]==1
    assert db.execute("select count(*) from Product where family='NEGOCE' and sku like 'MP-MOU-PUR-STD-D33-%'").fetchone()[0]==1
    print('PASS SQL integrity/foreign keys, cross-catalogue, foam, prices, purchaseUnits, lots and fixtures')

# Test true trigger operation on isolated copy, rollback at end.
with tempfile.TemporaryDirectory(prefix='gocmd_demo_check_') as tmp:
    p=Path(tmp)/'test.db';shutil.copy2(DB,p)
    with closing(sqlite3.connect(p)) as db:
        db.execute('PRAGMA foreign_keys=ON')
        prod=db.execute('''SELECT p.id,p.unitPrice,p.unit,m.unit,l.id,l.qty FROM Product p
              JOIN Material m ON m.id=p.materialId JOIN StockLot l ON l.materialId=m.id
              WHERE p.family='NEGOCE' AND l.qty>=6 AND l.status='available' AND m.unit=p.unit
              ORDER BY l.id LIMIT 1''').fetchone()
        assert prod, 'aucun produit de négoce disponible pour simulation réservation'
        pid,salesprice,salesunit,stockunit,lotid,available=prod
        client=db.execute('SELECT id FROM Client LIMIT 1').fetchone()[0]
        db.execute("INSERT INTO \"Order\"(ref,clientId,status) VALUES ('CMD-DEMO-RECETTE-REJET',?,'new')",(client,))
        oid=db.execute('SELECT last_insert_rowid()').fetchone()[0]
        db.execute('''INSERT INTO OrderLine(orderId,productId,qty,unit,unitPrice,stockUnit,stockUnitsPerSale)
                      VALUES (?,?,?,?,?,?,1)''',(oid,pid,available,salesunit,salesprice,stockunit))
        lid=db.execute('SELECT last_insert_rowid()').fetchone()[0]
        db.execute("INSERT INTO SalesStockReservation(orderLineId,stockLotId,qty,createdBy) VALUES (?,?,2,'demo')",(lid,lotid))
        assert db.execute('SELECT SUM(qty) FROM SalesStockReservation WHERE stockLotId=?',(lotid,)).fetchone()[0]==2
        def refuse(sql,args):
            try:
                db.execute(sql,args)
            except sqlite3.IntegrityError:return
            raise AssertionError('Contrôle SQL non appliqué: '+sql)
        refuse("INSERT INTO SalesStockReservation(orderLineId,stockLotId,qty,createdBy) VALUES (?,?,?,'demo')",(lid,lotid,available))
        refuse('UPDATE StockLot SET qty=1 WHERE id=?',(lotid,))
        refuse("UPDATE StockLot SET status='quarantine' WHERE id=?",(lotid,))
        db.rollback()
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        print('PASS SQL reservation oversubscription, stock reduction and quarantine prevented (isolated copy)')
print('FIXTURE SUMMARY',json.dumps(stats,ensure_ascii=False))
