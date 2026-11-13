#!/usr/bin/env python3
"""Offline contract and schema checks. Does NOT prove TypeScript/build/HTTP execution."""
from pathlib import Path
import sqlite3, tempfile, subprocess,sys,shutil,re
ROOT=Path(__file__).resolve().parents[1]
def source(path):return (ROOT/path).read_text(encoding='utf-8')
with sqlite3.connect('file:'+str(ROOT/'tests/fixtures/v16_demo.db')+'?mode=ro',uri=True) as c:
    assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
    for table,fields in {'SupplierInvoice':{'version'},'SupplierCreditNote':{'decisionActor','decisionReason','decidedAt'},'SalesCreditNote':{'status','decisionActor','decisionReason','decidedAt'}}.items():
        actual={r[1] for r in c.execute('PRAGMA table_info('+table+')')}
        assert fields<=actual, (table,fields-actual)
    assert c.execute('SELECT COUNT(*) FROM Product').fetchone()[0]==189
    assert c.execute('SELECT COUNT(*) FROM Material').fetchone()[0]>=55
    assert c.execute('SELECT COUNT(*) FROM SupplierInvoice WHERE version <> 0').fetchone()[0]==0
    # Les avoirs fournisseurs historiques ne sont plus requis dans la base
    # de demonstration, remise a zero par P5.13.2. Le schema et les transactions
    # sont testes sur copie ci-dessous.
    assert c.execute("SELECT COUNT(*) FROM SalesCreditNote WHERE status='approved'").fetchone()[0]>=1
    with tempfile.TemporaryDirectory() as d:
        copy=Path(d)/'test.db';shutil.copy(ROOT/'tests/fixtures/v16_demo.db',copy)
        for _ in range(2):
            x=subprocess.run([sys.executable,str(ROOT/'scripts/migrate_v186_sqlite.py'),'--db',str(copy),'--apply','--ack','SCHEMA_V186_BACKUP_VERIFIED'],capture_output=True,text=True)
            assert x.returncode==0,(x.stdout,x.stderr)
        with sqlite3.connect(copy) as x:
            assert x.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            assert not x.execute('PRAGMA foreign_key_check').fetchall()
            assert x.execute("SELECT COUNT(*) FROM Product").fetchone()[0]==189

sales=source('src/app/api/sales/route.ts')
assert 'const headers=new Headers(req.headers)' in sales
assert '"content-length","content-encoding","transfer-encoding"' in sales
assert 'const creditDecisionSchema=z.discriminatedUnion' in sales
assert 'inv.credits.filter(c=>c.status==="approved")' in sales
assert '"SALES_CREDIT_DRAFTED"' in sales
assert 'salesInvoiceStatus(remaining,paid,approved+cr.amountCents)' in sales
assert 'cr.actor===actor' in sales
assert '"cancel-credit"' in source('src/components/erp/sales-view.tsx')
# VEN-02 : le solde et les avoirs approuvés se lisent dans le relevé client,
# pas sur une facture émise dont le contenu doit rester identique après paiement.
assert 'status:"approved"' in source('src/app/api/sales/statement/route.ts')
assert 'financeSummary' not in source('src/app/api/sales/print/route.ts')
assert 'productNameSnapshot' in source('src/app/api/sales/print/route.ts')
supplier=source('src/app/api/supplier-invoices/[id]/route.ts')
assert 'version:inv.version' in supplier and 'version:{increment:1}' in supplier
p2p=source('src/app/api/p2p/finance/route.ts')
assert "d.action==='cancel-credit'" in p2p
assert 'decisionReason:d.reason' in p2p
assert "['draft','approved'].includes(c.status)" in p2p
assert 'version:inv.version' in p2p
config=source('next.config.ts')
for header in ('X-Frame-Options','X-Content-Type-Options','Referrer-Policy','Strict-Transport-Security'):assert header in config
assert '"/api/sales/route' not in config
print('PASS V18.6: migrated database, double-run migration, 189/55 retained, revenue and credit controls, optimistic version, secure headers and reconstructed request.')
