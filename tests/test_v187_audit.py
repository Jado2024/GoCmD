"""V18.7 offline integrity + guarded source contract; not an HTTP or type-check substitute."""
import pathlib, sqlite3, hashlib, json
ROOT=pathlib.Path(__file__).resolve().parents[1]
route=(ROOT/'src/app/api/supplier-invoices/[id]/route.ts').read_text()
finance=(ROOT/'src/app/api/p2p/finance/route.ts').read_text()
ui=(ROOT/'src/components/erp/p2p-control-view.tsx').read_text()
assert 'invoiceUnreservedCents(inv.totalAmount,inv.payments.map(p=>p.amount),inv.credits.filter(c=>c.kind===\'balance\'))' in route  # V18.9.2 : avoirs post-reglement exclus
assert 'paidCents>unreservedCents' in route
assert 'invoiceUnreservedCents(i.totalAmount,i.payments.map(p=>p.amount),balanceCredits)' in finance  # V18.9.2 : avoirs de solde seulement
assert 'availableToReserve:' in finance
assert '?.availableToReserve??0' in ui
assert 'Montant non réservé' in ui
# V18.9.1 (contre-audit A-01) : le document historique est renommé en ASCII pur
# pour que l'archive ZIP reste reproductible sur tout extracteur (Windows/CP850,
# Python/CP437). Le test garde sa force : il exige la présence du document.
assert (ROOT/'docs/historique/README_V18_5_AUDIT_REMEDIATIONS.md').is_file()
assert (ROOT/'scripts/migrate_v186_sqlite.py').is_file()
ignore=(ROOT/'.gitignore').read_text()
assert 'db/*.before_v*.bak' in ignore and 'db/*.db-wal' in ignore and 'db/*.db-shm' in ignore
with sqlite3.connect(f'file:{ROOT}/tests/fixtures/v16_demo.db?mode=ro',uri=True) as db:
 assert db.execute('pragma integrity_check').fetchone()[0]=='ok'
 assert not db.execute('pragma foreign_key_check').fetchall()
 assert db.execute('select count(*) from Product').fetchone()[0]==189
 assert db.execute('select count(*) from Material').fetchone()[0]>=55
print('PASS V18.7: route/UI contracts, historical preservation, SQLite 189/55 integrity')
