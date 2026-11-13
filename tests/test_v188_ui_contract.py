"""Contrats statiques interface V18.8, sans navigateur ni dépendances Next."""
# P5.15.20 — contrat « pilotage ne charge pas finance sans rôle » modernisé :
# le composant a été refactoré (P5.15.7 pagination/pilotage) ; la garantie
# équivalente est désormais portée par (1) le chargement des URL finance
# conditionné à l'aire courante (`current.area==='finance'`) et (2) la liste
# d'actions filtrée par rôle (`actions.filter(a=>allowed(a.area,a.id))`) :
# sans rôle finance, aucune action d'aire finance n'est sélectionnable, donc
# aucune URL finance n'est chargée. La forme littérale historique
# `if(hasRole(identity,'finance'))` n'existe plus.
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ui=lambda name:(ROOT/'src/components/erp'/name).read_text()
checks={
 'client explicite sans premier client automatique':'clientId??clients.data?.items[0]' not in ui('new-order-dialog.tsx') and 'const effectiveClientId=clientId' in ui('new-order-dialog.tsx'),
 'récapitulatif client':'Récapitulatif avant validation' in ui('new-order-dialog.tsx'),
 'confirmation d’abandon':'Abandonner les modifications non enregistrées' in ui('new-order-dialog.tsx'),
 'intitulé devis':'launchMode==="quote"' in ui('new-order-dialog.tsx'),
 'permission finance vente':'canFinance&&available>0' in ui('sales-view.tsx') and '{canFinance&&<section' in ui('sales-view.tsx'),
 'mode règlement réel':'method:paymentMethod' in ui('sales-view.tsx') and 'Mode de règlement réel' in ui('sales-view.tsx'),
 'historique du mode':'p.method??"mode non renseigné"' in ui('sales-view.tsx'),
 'erreurs factures et devis': 'invoices.isError' in ui('sales-view.tsx') and 'quotes.isError' in ui('sales-view.tsx') and 'invoices.refetch()' in ui('sales-view.tsx'),
 'DA conditionnées au rôle':'canApprove&&p.status==="pending"' in ui('purchases-view.tsx'),
 'BC conditionnés au rôle':'canApprove&&b.status==="draft"' in ui('supply-chain-view.tsx'),
 'qualité conditionnée au rôle':'canQuality&&l.qty>0' in ui('p2p-control-view.tsx'),
 'quantité motif QA':'trim().length<10' in ui('p2p-control-view.tsx'),
 'pilotage ne charge pas finance sans rôle':"if(current.area==='finance')urls.push(['finance',urlFor.finance]" in ui('p2p-advanced-view.tsx') and "actions.filter(a=>allowed(a.area,a.id))" in ui('p2p-advanced-view.tsx'),
 'pilotage données indépendantes':'Promise.allSettled' in ui('p2p-advanced-view.tsx'),
 'pilotage aucune saisie JSON':"JSON [{" not in ui('p2p-advanced-view.tsx') and 'revisionLines.map' in ui('p2p-advanced-view.tsx'),
 'recherche transmise au catalogue':'searchTerm={globalSearch}' in ui('erp-app.tsx') and 'setQ(searchTerm)' in ui('catalogue-view.tsx'),
 'recherche mobile':'mobileSearchOpen' in ui('erp-app.tsx'),
 'footer fidèle connexion':'dashboard.isError?"Données indisponibles"' in ui('erp-app.tsx'),
 'tableaux mobiles et libellés':'hidden overflow-x-auto md:block' in ui('supply-chain-view.tsx') and 'aria-label={`Quantité acceptée' in ui('supply-chain-view.tsx'),
}
for name,ok in checks.items():
 print(('PASS' if ok else 'FAIL')+' — '+name)
assert all(checks.values()), 'Contrat UX V18.8 non satisfait'
print(f'V18.8 : {len(checks)} contrôles PASS')
