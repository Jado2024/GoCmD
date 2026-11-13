"""V18.9.9 — contrats statiques de durcissement (QA-CI-01, SEC-LEGACY-01,
SEC-PROD-01, SEC-PROD-02, DONNEES-01). Ces contrôles ne remplacent pas les
recettes HTTP sur serveur isolé (ci-v1896-isolated-http.cjs et
http-v1899-business-recipe.cjs)."""
from pathlib import Path
import sqlite3
root=Path(__file__).resolve().parents[1]
read=lambda p:(root/p).read_text(encoding='utf8')

# --- SEC-LEGACY-01 : le mécanisme de compatibilité est supprimé du logiciel.
acl=read('src/lib/access-gate.ts')
assert 'process.env.GOCMD_ALLOW_LEGACY_WRITES' not in acl, 'le logiciel ne doit plus LIRE le drapeau legacy'
assert 'GOCMD_ALLOW_LEGACY_WRITES!=="1"' not in acl and 'GOCMD_ALLOW_LEGACY_WRITES==="1"' not in acl, 'aucune condition sur le drapeau legacy'
assert 'if(actor.legacy)return false' in acl, 'hasRole refuse toujours le compte partagé'
assert 'if(actor.legacy)return Response.json({error:"Mode démonstration en lecture seule' in acl, 'écriture toujours refusée au compte partagé'
env=read('.env.example')
assert 'GOCMD_ALLOW_LEGACY_WRITES' not in env.replace('ancien drapeau GOCMD_ALLOW_LEGACY_WRITES a été',''), 'env.example documente la suppression'
nav=read('src/lib/role-navigation.ts')
legacy_nav=nav.split('if(actor.legacy)return')[1].split(']')[0]
for forbidden_view in ['"sales-quotes"','"orders"','"sales-deliveries"','"sales-invoices"','"purchases"']:
    assert forbidden_view not in legacy_nav, f'navigation partagée ne doit pas contenir {forbidden_view}'
for allowed_view in ['"dashboard"','"materials"','"catalogue"','"movements"','"stock-lots"','"suppliers"','"supplier-orders"','"goods-receipts"']:
    assert allowed_view in legacy_nav, f'navigation partagée devrait conserver {allowed_view}'
sec=read('tests/security-regression.cjs')
assert "legacy writes denied even with legacy flag" in sec, 'test unitaire du blocage legacy écritures'
assert "legacy account never gets finance role" in sec, 'test unitaire rôles legacy'

# --- QA-CI-01 : plus aucune contradiction rôle/URL dans la porte CI.
ci=read('tests/ci-v1896-isolated-http.cjs')
import re
role_arrays=re.findall(r"for\(const role of \[([^\]]+)\]\)", ci)
assert role_arrays, 'boucles de rôles attendues dans la porte CI'
# La boucle 403 clients/commandes ne contient pas le commercial :
op_loop=None
for arr in role_arrays:
    segment=ci.split(arr)[1][:1200]
    if "'/api/clients'" in segment and "'/api/orders'" in segment and '403' in segment:
        op_loop=arr
        break
assert op_loop is not None, 'boucle 403 clients/commandes attendue'
op_roles=[r.strip().strip("'") for r in op_loop.split(',')]
assert set(op_roles)=={'receiver','inventory','quality'}, f'rôles de la boucle 403 inattendus: {op_roles}'
assert "sales reads /api/clients (200 expected — contradiction removed)" in ci, 'commercial explicitement autorisé en lecture clients'
# Le scénario pire-cas du compte partagé est bien présent (SEC-LEGACY-01).
assert "scenarioLegacySharedAccount" in ci and "GOCMD_ALLOW_LEGACY_WRITES:'1'" in ci, 'scénario compte partagé pire-cas attendu'

# --- SEC-PROD-01 : DTO appliqué partout, y compris imbrications.
for route in ['src/app/api/products/route.ts','src/app/api/products/[id]/route.ts',
              'src/app/api/orders/route.ts','src/app/api/orders/[id]/route.ts','src/app/api/sales/route.ts']:
    s=read(route)
    assert 'productDtoForActor' in s, f'DTO manquant dans {route}'
assert 'mayReadNonActiveProduct' in read('src/app/api/products/[id]/route.ts'), 'contrôle de statut par produit manquant'
assert 'Produit introuvable' in read('src/app/api/products/[id]/route.ts'), '404 uniforme pour propositions confidentielles'

# --- DONNEES-01 : méthode de synthétisation fournie et base distribuée propre.
assert (root/'scripts/sanitize-demo-clients-v1899.py').is_file()
con=sqlite3.connect(str(root/'db/custom.db'))
assert con.execute('pragma integrity_check').fetchone()[0]=='ok'
assert not con.execute('pragma foreign_key_check').fetchall()
bad=con.execute("select count(*) from Client where name not like 'CLIENT-DEMO-__-FICTIF' or city<>'VILLE-DEMO' or phone is not null").fetchone()[0]
assert bad==0, f'{bad} fiches clients non synthétiques dans la base distribuée'
orders=con.execute('select count(*) from "Order"').fetchone()[0]
quotes=con.execute('select count(*) from SalesQuote').fetchone()[0]
# P5.15.20 : la base de démonstration distribuée a été remise à zéro transaction
# à la référence P5.15.17 (attesté par scripts/verify_demo_base_p51517.py :
# « zéro DA, BC, BR » et transactions à 0). L'ancien attendu (5 commandes,
# 7 devis) décrivait la base d'avant P5.15.17.
assert orders==0 and quotes==0, 'base distribuée conforme à la référence P5.15.17 sans transactions'

print('PASS V18.9.9 — contrats statiques : legacy neutralisé, CI sans contradiction, DTO produits, base démo synthétique')
