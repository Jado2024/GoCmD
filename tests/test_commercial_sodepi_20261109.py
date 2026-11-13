#!/usr/bin/env python3
"""Contrats statiques du parcours commercial SODEPI; ne remplacent pas la recette HTTP."""
from pathlib import Path
import sqlite3
root=Path(__file__).resolve().parents[1]
read=lambda x:(root/x).read_text(encoding='utf-8')
orders=read('src/app/api/orders/route.ts')
order_action=read('src/app/api/orders/[id]/route.ts')
quotes=read('src/app/api/sales/route.ts')
forms=read('src/components/erp/new-order-dialog.tsx')
work_create=read('src/lib/work-order-create.ts')
work_action=read('src/app/api/work-orders/[id]/route.ts')
work_list=read('src/app/api/work-orders/route.ts')
access=read('src/lib/access-gate.ts')
labels=read('src/components/erp/label-sheet.tsx')
contract={
 'devis et commande via éditeurs distincts': 'launchMode==="quote"' in forms and 'submit(true)' in forms and 'submit(false)' in forms,
 'accord client obligatoire au devis': 'acceptanceRef.length<3' in quotes,
 'conversion devis par endpoint commande': 'return createCustomerOrder(' in quotes,
 'commande directe autorisée': 'validatedOrderStatus' in orders,
 'tarif hors catalogue soumis au visa directeur': 'needsPriceReview' in orders and 'approve-prices' in order_action,
 'visa directeur seul': 'hasRole(req,"director")' in order_action and 'hasRole(req,"director")' in quotes,
 'séparation des tâches pour toutes les commandes': 'SELF_REVIEW_FORBIDDEN' in order_action,
 'visa tarifaire du devis avant envoi': 'DIRECTOR_PRICE_REQUIRED' in quotes and 'approve-quote-prices' in quotes,
 'OF bloqués avant approbation': 'createMissingWorkOrders(tx, created.id' not in orders and 'ORDER_NOT_APPROVED' in work_create,
 'OF atomiques après approbation': 'createMissingWorkOrders(tx, oid, actor)' in order_action,
 'OF automatiquement utilisables': 'status:"approved",approvedBy:"SYSTEM:CMD_CONFIRMED"' in work_create,
 'OF générés pour négoce': 'stockTrade: line.product.materialId !== null' in work_create,
 'OF uniques par ligne': 'orderLineId Int @unique' in read('prisma/schema.prisma'),
 'aucun stock décrémenté à la création OF': 'movement.create' not in work_create and 'finishedStockMovement.create' not in work_create,
 'notes techniques figées dans OF': 'technicalInstructions:line.kind==="GENERIC"' in "".join(work_create.split()) and 'line.technicalInstructions' in work_create and 'frozen?.specifications' in work_create,
 'dimensions figées dans OF': 'customDimensionsJson' in work_create and 'defaultDimensions: l.dimensions' in orders,
 'contrôle technique des modifications': 'hasTechnicalException' in orders and 'technicalReviewRequired' in orders,
 'préparation par magasinier': 'hasRole(req,"inventory")' in work_action and 'hasPermission(req,"stock.move")' in work_action,
 'pas de contournement des permissions OF': 'work-orders' in access and 'return null' in access and 'hasPermission(req,"sales.approve")' in work_action,
 'file des OF active sans commandes suspendues': 'fulfillmentStatus:"open"' in work_list,
 'transitions sérialisées SQLite': 'serializedSQLiteWrite' in work_action and 'serializedSQLiteWrite' in orders,
 'impression bloquée sur OF non approuvé': 'of.status==="draft" || of.status==="cancelled"' in labels,
 'tissus mousse et modifications visibles à atelier': 'technicalInstructions' in labels and 'specialNotes' in labels,
 'commerce historique préservé': 'WORK_ORDERS_NOT_COMPLETED' in order_action,
 'stock préservé et libération réservation': 'finishedStockReservation.deleteMany' in order_action,
 'nouvelle migration versionnée': (root/'scripts/upgrade_commercial_sodepi_20261109.py').exists(),
}
for key,value in contract.items():print(('PASS' if value else 'FAIL'),key)
assert all(contract.values()),'Contrat commercial incomplet'
con=sqlite3.connect(root/'db/custom.db')
assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert not con.execute('PRAGMA foreign_key_check').fetchall()
cols={x[1] for x in con.execute('PRAGMA table_info("OrderLine")')}
assert {'priceApprovalStatus','technicalInstructions','customDimensionsJson','technicalReviewRequired'}.issubset(cols)
qcols={x[1] for x in con.execute('PRAGMA table_info("SalesQuote")')}
assert {'priceReviewRequired','priceApprovedBy','priceApprovalReason'}.issubset(qcols)
print(f'PASS {len(contract)} contrôles statiques + intégrité SQLite (ne remplacent pas HTTP/build)')
