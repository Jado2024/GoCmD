#!/usr/bin/env python3
"""Vérifications statiques ciblées des garde-fous, sans serveur ni simulation d'habilitation."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
read=lambda x:(root/x).read_text()
api=read('src/app/api/work-orders/route.ts')
patch=read('src/app/api/work-orders/[id]/route.ts')
labels=read('src/components/erp/label-sheet.tsx')
css=read('src/app/globals.css')
steps=read('src/app/api/orders/[id]/route.ts')
panel=read('src/components/erp/work-orders-panel.tsx')
checks={
 'écriture OF réservée à approbateur sans commercial obligatoire': 'return hasRole(req,"approver") &&' in api and 'hasRole(req,"sales")' not in api,
 'lecture OF sans droit client interdite': 'hasPermission(req,"clients.read")' in api,
 'contrôle serveur des permissions': ('"sales.approve","clients.read"' in api and 'hasPermission(req,"stock.move")' in patch and 'hasPermission(req,"sales.approve")' in patch and 'work-orders' in read('src/lib/access-gate.ts') and 'return null' in read('src/lib/access-gate.ts')),
 'anti-doublon commande-ligne': 'orderLineId Int @unique' in read('prisma/schema.prisma'),
 'vérification de validation produit': 'PRODUCT_NOT_APPROVED' in read('src/lib/work-order-create.ts'),
 'garantie du statut approbation': 'SELF_APPROVAL' in patch and 'item.createdBy===actor' in patch,
 'OF aussi pour le négoce': 'stockTrade: line.product.materialId !== null' in read('src/lib/work-order-create.ts'),
 'file SQLite sérialisée sur les écritures': 'serializedSQLiteWrite' in api and 'serializedSQLiteWrite' in patch,
 'aucun mouvement créé par un OF': 'stockLot.update' not in patch and 'finishedStockLot.update' not in patch and 'movement.create' not in read('src/lib/work-order-create.ts') and 'finishedStockMovement.create' not in patch,
 'gabarits dessins existants': 'gabaritByCode(p.gabaritCode' in labels,
 'matelas sans dessin de gabarit': 'hasTechnicalDrawing(s.product.family,p.gabaritCode)' in labels,
 'impression OF brouillon et annulé refusée': 'of.status==="draft" || of.status==="cancelled"' in labels,
 '8 par page A4 2x4': 'grid-template-rows: repeat(4,67.5mm)' in css and 'repeat(2,94.5mm)' in css,
 'dates et numérotation individuelles': 'index+1' in labels and 'of.ref' in labels,
 'status commande contrôlé après OF': 'WORK_ORDERS_NOT_APPROVED' in steps and 'WORK_ORDERS_NOT_COMPLETED' in steps,
 'respect mode historique et mode strict': 'GOCMD_REQUIRE_OF_FOR_PRODUCTION' in steps,
 'seul approbateur habilité voit les actions': 'const manager=hasRole(session,"approver")&&' in panel and 'hasRole(session,"sales")' not in panel,
 'OF uniquement après approbation quatre yeux': 'createMissingWorkOrders(tx' not in read('src/app/api/orders/route.ts') and 'if (action === "approve") await createMissingWorkOrders(tx' in steps and 'SELF_REVIEW_FORBIDDEN' in steps,
 'vente non livrable avec OF incomplet': 'OF_INCOMPLETE_OR_MISSING' in read('src/app/api/sales/route.ts'),
 'OF négoce imprimable': 'WorkOrderPreparationLabel' in labels,
}
for label,good in checks.items():print(('PASS' if good else 'FAIL'),label)
assert all(checks.values()),'Contrat sécurité incomplet'
print('PASS :',len(checks),'contrôles statiques (ne remplacent PAS des tests HTTP)')
