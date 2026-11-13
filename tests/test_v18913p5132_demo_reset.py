"""Read-only acceptance of the demo reset; never mutates user's database."""
import argparse
import sqlite3
from pathlib import Path

EMPTY = ['PurchaseRequest','PurchaseRequestLine','PurchaseReceipt','PurchaseReceiptLine',
 'SupplierRFQ','SupplierQuoteOffer','SupplierConsultation','SupplierConsultationLine',
 'SupplierConsultationRecipient','SupplierConsultationRecipientLine','SupplierOfferAttachment',
 'SupplierOrder','SupplierOrderLine','SupplierOrderRevision','SupplierDeliveryNote',
 'SupplierDeliverySchedule','GoodsReceipt','GoodsReceiptLine','SupplierInvoice','SupplierInvoiceLine',
 'SupplierPayment','SupplierReturn','SupplierDispute','QualityInspection','StockCount']

def test(db: Path):
    c=sqlite3.connect(str(db))
    c.row_factory=sqlite3.Row
    assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not list(c.execute('PRAGMA foreign_key_check'))
    for t in EMPTY:
        assert c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]==0, f'{t} non vide'
    n=c.execute('SELECT COUNT(*) FROM Material').fetchone()[0]
    zeros=c.execute('SELECT COUNT(*) FROM Material WHERE stockQty=0 AND minStock>0').fetchone()[0]
    low=c.execute('SELECT COUNT(*) FROM Material WHERE stockQty>0 AND stockQty<minStock').fetchone()[0]
    assert n>=55 and zeros>=15 and low>=15, (n,zeros,low)
    assert not list(c.execute('''SELECT m.id FROM Material m LEFT JOIN StockLot l ON l.materialId=m.id AND l.status='available'
           GROUP BY m.id HAVING ABS(m.stockQty-COALESCE(SUM(l.qty),0))>0.0001'''))
    assert not list(c.execute('''SELECT l.id FROM StockLot l LEFT JOIN StockPlacement p ON p.stockLotId=l.id
           GROUP BY l.id HAVING ABS(l.qty-COALESCE(SUM(p.qty),0))>0.0001'''))
    assert not list(c.execute('''SELECT m.ref FROM Material m JOIN SupplierMaterial sm ON sm.materialId=m.id
            WHERE m.category='Mousse' AND (m.foamNature='AGGLO' OR lower(m.name) LIKE '%agglomér%')'''))
    assert not list(c.execute('''SELECT materialId FROM SupplierMaterial GROUP BY materialId
               HAVING SUM(CASE WHEN preferred=1 THEN 1 ELSE 0 END) > 1'''))
    # Jeu de démonstration V16+ (68 matières) : la référence D30 du premier jeu P5.13.2
    # (55 matières) a évolué avec la regénération documentée du jeu démo ; l'histoire
    # d'achat démontrée (bloc pur D30 multi-fournisseurs + suggestions communes) est conservée.
    d30=c.execute('''SELECT id,stockQty,unit FROM Material WHERE ref=?''',
        ('MP-MOU-PUR-STD-D30-JAU-BLC-MOY-LG190-LR90-HT100-001',)).fetchone()
    assert d30 and d30['unit']=='bloc', 'référence D30 du jeu démo introuvable'
    offers=list(c.execute('''SELECT s.name,sm.unitPrice FROM SupplierMaterial sm JOIN Supplier s ON s.id=sm.supplierId
            WHERE sm.materialId=?''',(d30['id'],)))
    assert len(offers)>=3, offers
    assert any('INNOFLEX' in a['name'].upper() for a in offers), offers
    common=c.execute('''SELECT COUNT(*) FROM Material m WHERE m.stockQty<m.minStock AND m.id != ?
             AND EXISTS (SELECT 1 FROM SupplierMaterial a JOIN SupplierMaterial b ON b.supplierId=a.supplierId
               WHERE a.materialId=? AND b.materialId=m.id)''',(d30['id'],d30['id'])).fetchone()[0]
    assert common>=4, f'Pas assez de suggestions communes : {common}'
    print(f'PASS P5.13.2 : {n} matières, {zeros} ruptures, {low} sous seuil, {common} suggestions partageant fournisseur D30 ; FK/lots/placements/DA/RFQ/BC OK')
    c.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',default='db/custom.db');a=p.parse_args()
    test(Path(a.db).resolve())
