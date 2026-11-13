"""Static regression guard for R5. This is NOT a browser/HTTP certification."""
from pathlib import Path
import sqlite3
ROOT=Path(__file__).resolve().parents[1]

def read(p): return (ROOT/p).read_text(encoding='utf-8')
work=read('src/lib/work-order-create.ts')
route=read('src/app/api/work-orders/route.ts')
review=read('src/app/api/orders/[id]/route.ts')
order_ui=read('src/components/erp/new-order-dialog.tsx')
of_ui=read('src/components/erp/work-orders-panel.tsx')
ci=read('.github/workflows/ci.yml')
assert 'lineRequiresWorkOrder(line.kind, line.technicalSnapshotJson)' in work
assert 'verifyWorkOrderContract(line)' in work
assert 'technicalSnapshotHash' in work and 'CONTRACT_SNAPSHOT_HASH_MISMATCH' in work
assert 'PREPARATION_NOT_REQUIRED' in route
assert 'lineRequiresWorkOrder(l.kind,l.technicalSnapshotJson)' in review
assert 'genericRequiresPreparation' in order_ui and 'requiresPreparation:genericRequiresPreparation' in order_ui
assert 'needsPreparation===true' in of_ui and 'Aucun OF requis' in of_ui
assert 'test:v2:r5' in ci
con=sqlite3.connect(ROOT/'db/custom.db')
assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
for table,expected in {'Material':82,'Product':218,'Supplier':18,'SupplierMaterial':135,'StockLot':64,'Client':10,'GoCmdUser':9}.items():
    actual=con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    assert actual==expected,(table,actual,expected)
for table in ('Order','SalesQuote','SupplierInvoice','GoodsReceipt','PurchaseRequest','WorkOrder','SalesDelivery','SalesInvoice'):
    assert con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]==0, table
assert con.execute("SELECT 1 FROM WarehouseSite WHERE code='SODEPI-DEMO'").fetchone()
for trigger in ('gocmd_p6_engagement_default_insert','gocmd_p6_engagement_immutable_update'):
    assert con.execute("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?", (trigger,)).fetchone(), trigger
assert con.execute('SELECT COUNT(*) FROM SalesStockReservation WHERE engagedAt IS NULL').fetchone()[0]==0
print('R5 delivery-policy static + SQLite: PASS')
