"""V18.4: static contract + immutable demo DB checks. Not an HTTP or TypeScript build test."""
from pathlib import Path
import sqlite3
R=Path(__file__).resolve().parents[1]
read=lambda f:(R/f).read_text(encoding='utf-8')
finance=read('src/app/api/p2p/finance/route.ts')
invoice=read('src/app/api/supplier-invoices/[id]/route.ts')
overview=read('src/app/api/p2p/overview/route.ts')
ui=read('src/components/erp/sales-view.tsx')
finance_ui=read('src/components/erp/p2p-control-view.tsx')
# The draft is not a posted credit; a distinct actor must approve or reject it.
assert "status:'draft',kind:'balance',actor" in finance  # V18.9.2 : nature explicite, le brouillon reste inerte
assert "credit.actor===actor" in finance
assert "status:'draft'},data:{status:'approved'" in finance
assert "data:{status,decisionActor:actor,decisionReason:d.reason,decidedAt:new Date()}" in finance
assert "creditCents>remainingCents" in finance and "creditCents===remainingCents" in finance
assert "AVOIR_AUTO_APPROBATION" in finance and "AVOIR_NON_BROUILLON" in finance
assert "status:{in:['draft','approved']}" in finance # Returned goods cannot be credited twice.
assert "inv.credits.filter(c=>c.status==='approved'&&c.kind==='balance'" in finance  # V18.9.2 : avoirs de solde seulement
assert "inv.credits.filter(c=>c.status==='approved'&&c.kind==='balance'" in invoice  # V18.9.2
assert "i.credits.filter(c=>c.status==='approved'&&c.kind==='balance'" in overview  # V18.9.2
assert "P2P_${d.action.toUpperCase().replaceAll('-','_')}" in finance
# UI exposes both preparation/approval and uses accessible, controlled dialogs.
assert 'action:"approve-credit"' in finance_ui
assert 'action:"reject-credit"' in finance_ui
assert 'action:"credit"' in finance_ui
assert "window.prompt" not in ui
assert '<Dialog open=' in ui and 'role="alert"' in ui
assert 'Number.isSafeInteger(amountCents)' in ui
with sqlite3.connect(f'file:{R}/tests/fixtures/v16_demo.db?mode=ro', uri=True) as db:
    assert db.execute('pragma integrity_check').fetchone()[0]=='ok'
    assert not db.execute('pragma foreign_key_check').fetchall()
    assert db.execute('select count(*) from Product').fetchone()[0] == 189
    assert db.execute('select count(*) from Material').fetchone()[0] == 55
    assert not db.execute('''select i.invoiceNumber from SupplierInvoice i where
      coalesce((select sum(amount) from SupplierPayment where invoiceId=i.id),0)+
      coalesce((select sum(amount) from SupplierCreditNote where invoiceId=i.id and status='approved'),0)>cast(i.totalAmount as real)+0.001''').fetchall()
print('PASS V18.4 static: separation of credit duties, settled-only accounting, controlled sales dialogs, intact DB')
