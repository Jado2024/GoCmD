"""Contrats structurels P5 — complément, pas substitut aux tests HTTP."""
from pathlib import Path
p=Path(__file__).resolve().parents[1]
api=(p/'src/app/api/orders/route.ts').read_text()
ui=(p/'src/components/erp/new-order-dialog.tsx').read_text()
quote=(p/'src/app/api/sales/route.ts').read_text()
helper=(p/'src/lib/order-duplicate.ts').read_text()
schema=(p/'prisma/schema.prisma').read_text()
assert 'duplicateReviewToken' in helper
assert 'normalizeCustomerOrderNo' in helper
assert 'MAX_CANDIDATES' in helper
assert 'findMany' in helper and 'dueDate:{gte:start,lt:end}' in helper
assert 'clientId_customerOrderNoNormalized' in helper
assert 'lookupOrderDuplicates(tx, data)' in api
assert api.index('lookupOrderDuplicates(tx, data)') < api.index('const ref = await nextRef(')
assert api.index('const ref = await nextRef(') < api.index('await tx.order.create(')
assert 'CUSTOMER_ORDER_DUPLICATE_CONFIRMED' in api
assert 'CUSTOMER_ORDER_NUMBER_EXISTS' in helper and 'DUPLICATE_ORDER_POTENTIAL' in helper
assert 'duplicateReview' in quote and 'quoteId:quote.id' in quote
assert 'duplicate-check' in ui and 'duplicateReason' in ui
assert 'customerOrderNoNormalized String?' in schema
assert '@@unique([clientId, customerOrderNoNormalized])' in schema
assert 'Idempotency-Key' in api and 'createRequestDigest' in api
# P6U : le contrat doublon reste testé ; une commande nouvellement saisie
# n'émet plus d'OF avant le visa commercial nominatif et indépendant.
review=(p/'src/app/api/orders/[id]/route.ts').read_text()
assert 'createMissingWorkOrders(tx, created.id, actorName)' not in api
assert 'if (action === "approve") await createMissingWorkOrders(tx, oid, actor)' in review
print('P5 contrat statique + visa P6U — contrôles PASS (ne vaut pas recette HTTP)')
