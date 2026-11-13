"""Static contracts for corrected GoCmd V18.1, complementary to runtime cost tests.
These do not replace TS typecheck, frozen install or real HTTP test.
P5.15.8 : les contrats statuts BC/quotes et helper partagé suivent la
référence actuelle (remainingToOrder extrait dans purchase-availability.ts,
filtre Prisma incluant les brouillons) ; le jeu de données V16 est vérifié
sur la fixture versionnée. Aucune protection retirée.
"""
from pathlib import Path
import json,sqlite3
R=Path(__file__).resolve().parents[1]
source=lambda s:(R/s).read_text()
order=source('src/app/api/supplier-orders/route.ts')
# V18.1 original: deux filtres JS .includes(b.order.status) sur
# ["confirmed","partial","received"]. Le code actuel filtre côté Prisma
# (order:{status:{in:[...]}}) et réserve aussi les brouillons; l'exigence
# de fond (comptage des quantités déjà engagées par statut de BC) reste.
assert 'order:{status:{in:["draft","confirmed","partial","received"]}}' in order
# Le helper partagé reste appelé par la route des BC (deux usages historiques
# regroupés dans src/lib/purchase-availability.ts).
assert 'remainingToOrder' in order
assert 'receivedWeightedAverageCost(before.stockQty,' in source('src/app/api/goods-receipts/route.ts')
assert 'receivedWeightedAverageCost(oldMaterial.stockQty,' in source('src/app/api/quality-inspections/route.ts')
for file, codes in [
    ('src/app/api/quality-inspections/route.ts',('LEGACY_NOT_COUNTED','DA_EXCEEDED','NOT_FOUND')),
    ('src/app/api/supplier-returns/route.ts',('CREDIT_NOTE_REQUIRED','RECEIPT_RETURN_EXCEEDED','INSUFFICIENT_STOCK')),
    ('src/app/api/supplier-invoices/route.ts',('FOREIGN_RECEIPT',)),
]:
    s=source(file)
    assert 'p2pConflictResponse(e,' in s,file
    for code in codes:assert code in s,(file,code)
assert 'Object.prototype.hasOwnProperty.call(messages,code)' in source('src/lib/p2p-api-errors.ts')
assert 'P2002:' in source('src/app/api/supplier-invoices/route.ts')
sales=source('src/components/erp/sales-view.tsx')
for status in ('draft','sent','accepted','rejected','converted','issued','partial','paid','settled'):
    assert status+':' in sales,status
assert 'QUOTE_STATUS[q.status] ?? q.status' in sales
assert 'SALES_INVOICE_STATUS[inv.status] ?? inv.status' in sales
con=sqlite3.connect(f'file:{R}/tests/fixtures/v16_demo.db?mode=ro',uri=True)
assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
assert con.execute('select count(*) from Product').fetchone()[0]==189
assert con.execute('select count(*) from Material').fetchone()[0]==55
con.close()
print('PASS V18.1: corrected static contracts + demo SQLite integrity')
