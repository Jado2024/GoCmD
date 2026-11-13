"""VEN-01/02/03/04/07/08 : contrat de source, pas test HTTP.
Ces assertions empêchent la perte de garde pendant une refactorisation.
"""
from pathlib import Path
R=Path(__file__).resolve().parents[1]
get=lambda path:(R/path).read_text()
source=get('src/app/api/sales/route.ts')
order=get('src/app/api/orders/route.ts')
paper=get('src/app/api/sales/print/route.ts')
finished=get('src/app/api/sales/finished-stock/route.ts')
returns=get('src/app/api/sales/returns/route.ts')
workorder=get('src/app/api/work-orders/[id]/route.ts')
ui=get('src/components/erp/sales-view.tsx')
materials_ui=get('src/components/erp/materials-view.tsx')
checks={
 'commande conserve désignation': 'productNameSnapshot: frozenQuoteProducts[index]?.name??l.product.name' in order,
 'devis conserve noms': 'productsSnapshotJson:JSON.stringify' in source,
 'BL conserve libellés': 'productNameSnapshot:source.productNameSnapshot' in source,
 'facture conserve libellés': 'productNameSnapshot:l.productNameSnapshot' in source,
 'impression facture figée': 'financeSummary' not in paper and 'i.status' not in paper,
 'lots imprimés réel': 'l.stockAllocations.map' in paper and 'l.finishedAllocations.map' in paper,
 'réservation possible commande en cours': '["new","production","ready","shipped"].includes(o.status)' in source,
 'garde doublon source livraison': 'Livraison doublonnée' in source,
 'concurrence en sortie produit fini': 'finishedStockLot.updateMany' in source and 'qty:{gte:quantity}' in source,
 'lot fini reçu quarantaine': 'status:"quarantine"' in finished,
 'qualité différente réception': 'lot.receivedBy===actor' in finished,
 'retour plafonné au livré': 'returnedQty+d.qty>dl.qty' in returns,
 'retour pièce non doublée': 'DUPLICATE_PIECE_RETURN' in returns,
 'qualité retour 4 yeux': 'ret.receivedBy===actor||ret.createdBy===actor' in returns,
 'retour ne crée pas remboursement': 'Aucun avoir ni remboursement automatique' in returns,
 'préparation vérifie stock': 'STOCK_NOT_AVAILABLE_FOR_PREPARATION' in workorder,
 'stock fini en UI': 'FinishedQualityPanel' in materials_ui and '<FinishedQualityPanel/>' in materials_ui,
}
for name,result in checks.items():
 assert result,name
print(f'PASS {len(checks)}/{len(checks)} contrôles statiques ciblés ; tests HTTP non exécutés')
