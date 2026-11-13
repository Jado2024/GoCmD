"""R10 candidate: vérifications ciblées non destructives, indépendantes de Next.js.
Ces contrôles ne remplacent PAS Playwright, Node 24 ni la recette Windows.
"""
from pathlib import Path
import sqlite3

ROOT=Path(__file__).resolve().parents[1]
def source(p): return (ROOT/p).read_text(encoding='utf-8')
def expect(ok, message):
    if not ok: raise AssertionError(message)
    print('PASS',message)

move=source('src/components/erp/movements-view.tsx')
expect('w-full whitespace-normal' in move and 'sm:w-auto' in move, 'UX-002 bouton Archives responsive')
journey=source('src/components/erp/buyer-journey.tsx')
expect('ResizeObserver' in journey and 'scrollLeft+el.clientWidth<el.scrollWidth' in journey and 'canScroll.right' in journey, 'UX-005 affordance sur étapes cachées')
expect('tabIndex={0}' in journey, 'UX-005 zone défilante accessible au clavier')
sup=source('src/components/erp/supplier-management.tsx')
expect(sup.count('className="size-6 shrink-0 accent-rose-700"')==2, 'UX-004 deux cibles fournisseur >= 24px')
expect('className="size-6 shrink-0"/> Dimensions pertinentes' in source('src/components/erp/new-order-dialog.tsx'), 'UX-004 cible GEN-DIV >= 24px')
health=source('deploy/windows/verifier-sante.ps1')
expect('GOCMD_SQLITE_(CORRUPTION_SUSPECTED|OUTCOME_UNCERTAIN|UNSAFE_WAL|FOREIGN_KEYS_OFF)' in health and '-IsCritical' in health, 'EXP-02 alertes SQLite critiques incluses')
expect("$_.Name -notlike 'sante-*'" in health, 'EXP-02 exclusion journaux de santé auto-générés')
expect('Id=41,6008' in health and 'Id=41,1074' not in health, 'EXP-06 redémarrages planifiés non classés brutaux')
retry=source('src/lib/sqlite-write.ts')
expect('GOCMD_SQLITE_RETRY_EXHAUSTED' in retry and 'attempt >= 5 && canRetry' in retry, 'EXP-03 journalisation sans replay des transactions incertaines')
invoice=source('src/app/api/sales/print/route.ts')
expect('INVOICE_ISSUER_NOT_APPROVED' in invoice and 'GOCMD_ISSUER_ICE' in invoice and 'DOCUMENT DE SIMULATION' in invoice, 'FIN-01 mode facturation réelle fail-closed et DEMO explicite')
expect('GOCMD_INVOICE_COMPLIANCE_APPROVED="0"' in source('.env.example'), 'FIN-01 consentement administratif non présumé')

with sqlite3.connect(f'file:{ROOT / "db/custom.db"}?mode=ro',uri=True) as c:
 expect(c.execute('pragma integrity_check').fetchone()[0]=='ok','DB DEMO integrity_check')
 expect(not c.execute('pragma foreign_key_check').fetchall(),'DB DEMO foreign_key_check')
 for table in ['Material','Product','Supplier','SupplierMaterial','StockLot']:
  total=c.execute('select count(*) from "'+table+'"').fetchone()[0]
  expect(total>0, f'DB DEMO catalogue {table} = {total}')
 for table in ['Order','SalesInvoice','PurchaseRequest']:
  total=c.execute('select count(*) from "'+table+'"').fetchone()[0]
  expect(total==0,f'DB DEMO sans anciennes transactions {table}')
 expect(c.execute("select count(*) from sqlite_master where type='trigger'").fetchone()[0]>0,'DB DEMO triggers présents')
print('R10 remediation checks PASS (tests de contrats/SQLite, pas recette navigateur/Windows).')
