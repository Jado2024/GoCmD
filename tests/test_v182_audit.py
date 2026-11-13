"""V18.2 static invariants and demo DB: supplement, not a substitute for HTTP/build tests."""
from pathlib import Path
import sqlite3
R=Path(__file__).resolve().parents[1]
src=lambda x:(R/x).read_text()
finance=src('src/app/api/p2p/finance/route.ts')
payment=src('src/app/api/supplier-invoices/[id]/route.ts')
sourcing=src('src/app/api/p2p/sourcing/route.ts')
approve=src('src/app/api/supplier-orders/[id]/route.ts')
assert "inv.credits.filter(c=>c.status==='approved'&&c.kind==='balance').map(c=>c.amount)" in finance  # V18.9.2 : seuls les avoirs de solde reduisent le reste a payer
assert 'amountCents>remainingCents' in finance
assert "creditCents===remainingCents?{status:'paid'}" in finance
assert 'paidCents>unreservedCents' in payment and 'invoiceUnreservedCents' in payment  # V18.7: draft reservations now enforced on payments
assert all('serializedSQLiteWrite' in src(f) for f in ['src/app/api/p2p/finance/route.ts','src/app/api/supplier-invoices/[id]/route.ts','src/app/api/p2p/sourcing/route.ts','src/app/api/p2p/warehouse/route.ts','src/app/api/p2p/replenishment/route.ts','src/app/api/suppliers/route.ts'])
assert "newPurchaseQty=old.purchaseQty===null?null:l.qty/old.conversionFactor" in sourcing
assert 'purchaseQty:newPurchaseQty' in sourcing
assert 'lastRevision?.actor===actor' in approve
assert 'safeCsvCell' in src('src/app/api/p2p/overview/route.ts')
assert 'safeCsvCell' in src('src/app/api/p2p/accounting-export/route.ts')
assert "console.error('P2P finance transaction refused',safeErrorMetadata(e))" in finance
assert '!.env.example' in (R/'.gitignore').read_text()
assert not (R/'maquettes').exists(), 'historical screenshots should be outside the runtime package'
with sqlite3.connect(f'file:{R}/tests/fixtures/v16_demo.db?mode=ro',uri=True) as c:
    assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
    assert c.execute('pragma foreign_key_check').fetchall()==[]
    assert c.execute('select count(*) from Product').fetchone()[0]==189
    assert c.execute('select count(*) from Material').fetchone()[0]==55
    invalid=c.execute('''select i.invoiceNumber from SupplierInvoice i where
       coalesce((select sum(amount) from SupplierPayment where invoiceId=i.id),0)+
       coalesce((select sum(amount) from SupplierCreditNote where invoiceId=i.id and status='approved'),0)>cast(i.totalAmount as real)+0.001''').fetchall()
    assert not invalid, invalid
print('PASS V18.2: approval separation, unit conversion, finance, CSV, SQLite baseline')
