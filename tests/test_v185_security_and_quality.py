"""V18.5 static regression contract; does not replace tsc/build/HTTP tests."""
from pathlib import Path
import json
import sqlite3
R=Path(__file__).resolve().parents[1]
source=lambda rel:(R/rel).read_text(encoding='utf-8')
sales=source('src/components/erp/sales-view.tsx')
assert 'salesDialog&&salesDialog.kind!=="accept"?mad' not in sales
# V18.9.10 (UX-015) : formateur monétaire centralisé — mad() local remplacé
# par l'adaptateur fmtMADCents (délègue à fmtMAD, centimes conservés). Le
# contrat fonctionnel (affichage du solde maximal autorisé dans la modale)
# est inchangé ; l'assertion suit le nom canonique.
assert 'salesDialog?fmtMADCents(salesDialog.maxCents):"—"' in sales
assert 'alert(' not in source('src/components/erp/new-order-dialog.tsx')
overview=source('src/app/api/p2p/overview/route.ts')
assert 'moneyToCents(i.totalAmount)-paidCents-creditCents' in overview
assert "c.status==='approved'" in overview
proxy=source('src/proxy.ts')
assert '_next/image' not in proxy
assert 'unoptimized: true' in source('next.config.ts')
ui=source('src/components/erp/p2p-control-view.tsx')
assert 'c.actor===actorQ.data.username' in ui
p=json.loads(source('package.json'))
assert '@reactuses/core' not in p['dependencies']
assert tuple(map(int,p['dependencies']['next'].strip('^').split('.'))) >= (16,4,1)
with sqlite3.connect(f'file:{R}/tests/fixtures/v16_demo.db?mode=ro',uri=True) as db:
 assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
 assert db.execute('SELECT COUNT(*) FROM Product').fetchone()[0]==189
 assert db.execute('SELECT COUNT(*) FROM Material').fetchone()[0]>=55
print('PASS V18.5 static contracts + SQLite integrity (no mutation)')
