#!/usr/bin/env python3
"""Statically verify security checks at every relevant route.
Does not claim to replace authenticated HTTP acceptance tests.
"""
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]
load=lambda path:(ROOT/path).read_text(encoding='utf-8')
orders=load('src/app/api/orders/[id]/route.ts')
sales=load('src/app/api/sales/route.ts')
suppliers=load('src/app/api/suppliers/route.ts')
access=load('src/lib/access-gate.ts')
stock=load('src/app/api/stock-lots/route.ts')
ui=load('src/components/erp/movement-dialog.tsx')
ci=load('.github/workflows/ci.yml')
tests=load('tests/v18913p51521-auto-of.test.mjs')
checks={
 'Commande : rôle directeur + permission explicite avant transaction':
    bool(re.search(r'if\(body\?\.action==="approve-prices".*?\{\s*if\(!hasRole\(req,"director"\).*?actorIdentity\.managed && !hasPermission\(req,"director\.prices"\).*?requireDirectorPriceConfirmation\(req,body\.sensitivePassword\).*?serializedSQLiteWrite',orders,re.S)),
 'Devis : rôle directeur + permission explicite avant transaction':
    bool(re.search(r'if\(action==="approve-quote-prices" && \(!hasRole\(req,"director"\).*?!hasPermission\(req,"director\.prices"\).*?if\(action==="approve-quote-prices"\)',sales,re.S)),
 'Refus explicite du droit tarifaire dans la matrice RBAC':
    'director.prices' in load('src/lib/user-directory.cjs') and 'hasPermission(request:Request,key:string)' in access,
 'Association fournisseur : tarif entrant interdit si droit absent':
    'd.unitPrice!==undefined&&!canSeeMaterialCosts(req)' in suppliers,
 'Association fournisseur : DTO de sortie filtré':
    'supplierLinkForReader(link,canSeeMaterialCosts(req))' in suppliers and
    'return NextResponse.json({link:visibleLink}' in suppliers,
 'Association fournisseur : DTO n’altère pas le prix sauvegardé':
    'return canSeeCosts ? link : {...link,unitPrice:null}' in load('src/lib/supplier-link-visibility.ts'),
 'Association fournisseur : réponse non mise en cache':
    '"Cache-Control":"private, no-store"' in suppliers,
 'CI : test commercial et correctifs sécurité bloquants':
    'bun run test:commercial:sodepi' in ci and 'bun run test:security:closure' in ci,
 'Ancien OF : statut après confirmation, pas de double visa':
    "assert.equal(of.status,'approved'" in tests and "of.approvedBy,'SYSTEM:CMD_CONFIRMED'" in tests,
 'Stock : emplacement réservé à magasinier autorisé':
    'hasRole(req,"inventory")' in stock and 'hasPermission(req,"stock.read")' in stock,
 'Stock : UI affiche zone et signale emplacements multiples':
    'Emplacement enregistré' in ui and 'plusieurs emplacements' in ui,
 'Aucun nouveau scan ou étiquette imposés aux MP':
    'scan' not in ui.lower() and 'etiquette mp obligatoire' not in ui.lower(),
}
for k,v in checks.items():print(('PASS' if v else 'FAIL'),k)
assert all(checks.values()),'Contrôle de clôture sécurité/CI incomplet'
print(f'PASS {len(checks)} contrats statiques (HTTP, build et navigateur restent à exécuter séparément)')
