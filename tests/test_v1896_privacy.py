"""Privacy regression against pristine distributable archive and source contracts.
   Static tests are NOT a substitute for tests/ci-v1896-isolated-http.cjs in CI.
"""
import hashlib
import pathlib
import sqlite3
ROOT=pathlib.Path(__file__).resolve().parents[1]
def source(name):return (ROOT/name).read_text()

with sqlite3.connect(ROOT/'db/custom.db') as db:
    assert db.execute('pragma integrity_check').fetchone()[0]=='ok'
    assert not db.execute('pragma foreign_key_check').fetchall()
    assert db.execute('select count(*) from Client').fetchone()[0]==10
    # V18.9.9 (DONNEES-01) : les DIX fiches doivent être entièrement
    # synthétiques — aucune enseigne, ville ni téléphone d'origine réelle
    # ou non documentée ne peut être redistribuée dans l'archive de démo.
    for n in range(1,11):
        name,city,phone=db.execute('select name,city,phone from Client where id=?',(n,)).fetchone()
        assert name==f'CLIENT-DEMO-{n:02d}-FICTIF' and city=='VILLE-DEMO' and phone is None, f'fiche client {n} non synthétique'
    assert db.execute('select count(*) from Client where name not like "CLIENT-DEMO-__-FICTIF" or city<>"VILLE-DEMO" or phone is not null').fetchone()[0]==0
    # Le nombre d'operations achats est volontairement libre : la recette peut
    # etre reexecutee avant ou apres la creation de DA/BR fictifs.
    # Les contraintes utiles ici sont la privacy, les FK et l'integrite.
print('PASS DB — synthetic clients, original counts and valid foreign keys')
for route in ['src/app/api/goods-receipts/route.ts','src/app/api/supplier-returns/route.ts']:
    s=source(route)
    # P5.15.20 : la réponse anticipée des utilisateurs autorisés aux prix peut
    # inclure la pagination ajoutée par P5.15.x ({items} ou {items,pagination}) ;
    # l'intention du contrat — retour direct si prix visibles, sinon DTO épuré —
    # est inchangée.
    assert 'canSeeMaterialCosts(req)' in s
    assert ('if(pricing)return NextResponse.json({items})' in s
            or 'if(pricing)return NextResponse.json({items,pagination})' in s), route
    assert 'items:items.map(' in s
    print('PASS DTO',route)
s=source('src/app/api/p2p/sourcing/route.ts')
assert 'readRoleGate(req,["buyer","approver","finance"])' in s
assert 'currentActor(req)?.legacy' in s
assert 'ci-v1896-isolated-http.cjs' in source('.github/workflows/ci.yml')
assert 'bun run lint' in source('.github/workflows/ci.yml')
assert source('src/lib/access-gate.ts').count('!actor.legacy')>=2
assert 'unsafe-schema-change' in source('package.json')
print('PASS V18.9.6 — static contracts; HTTP validation remains independently required')
