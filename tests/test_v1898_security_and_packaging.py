"""Contrats statiques V18.9.8, explicitement pas des recettes HTTP."""
from pathlib import Path
import sqlite3
root=Path(__file__).resolve().parents[1]
read=lambda p:(root/p).read_text(encoding='utf8')
api=read('src/app/api/dashboard/route.ts')
ui=read('src/components/erp/dashboard-view.tsx')
acl=read('src/lib/access-gate.ts')
orders=read('src/app/api/orders/route.ts')
clients=read('src/app/api/clients/route.ts')
assert 'stockValue: canSeeCosts ? stockValue : null' in api
assert all('Cache-Control' in s and 'Vary' in s for s in [api,orders,clients])
assert 'byCategory: canSeeCosts ?' in api and 'flow: canSeeCosts ? days : []' in api
assert 'note: canSeeCommercial ? o.note : null' in api
assert '!actor.legacy' in api and '!actor.legacy' in orders and '!actor.legacy' in clients
assert 'if(actor.legacy)return false' in acl
assert 'stockValue: number | null' in read('src/lib/erp-types.ts')
assert 'kpi!.stockValue !== null ? (' in ui and 'Valorisation du stock et flux en MAD' in ui
assert 'kpi!.stockValue === null ? "Accès limité"' in ui
assert 'docs/historique/' not in read('README.md') or (root/'docs/historique').is_dir()
con=sqlite3.connect(str(root/'db/custom.db'))
assert con.execute('pragma integrity_check').fetchone()[0]=='ok'
assert not con.execute('pragma foreign_key_check').fetchall()
print('PASS V18.9.8 — contrats API+UI+RBAC, aucun cache, intégrité SQLite')
