from pathlib import Path
R=Path(__file__).resolve().parents[1]
def source(f):return (R/f).read_text(encoding='utf-8')
order=source('src/app/api/orders/[id]/route.ts')
hooks=source('src/components/erp/hooks.ts')
ui=source('src/components/erp/orders-view.tsx')
sales=source('src/app/api/sales/route.ts')
prices=source('src/app/api/products/[id]/director-price/route.ts')
confirm=source('src/lib/sensitive-confirmation.ts')
assert 'GOCMD_VALIDATION_KEY' not in order
assert 'approvalKey' not in order and 'approvalKey' not in hooks and 'approvalKey' not in ui
assert 'body:JSON.stringify({action,comment})' in hooks
assert 'hasRole(req,"approver")' in order and 'hasPermission(req,"sales.approve")' in order
assert 'SELF_REVIEW_FORBIDDEN' in order
assert 'createMissingWorkOrders(tx, oid, actor)' in order
assert 'requireDirectorPriceConfirmation(req,body.sensitivePassword)' in order
assert 'requireDirectorPriceConfirmation(req,input.sensitivePassword)' in prices
assert 'requireDirectorPriceConfirmation(req,parsed.data.sensitivePassword)' in sales
assert 'sensitive.confirm.failed' in source('src/lib/user-directory.cjs')
assert 'mot de passe personnel' in ui.lower() and 'quotePricePassword' in source('src/components/erp/sales-view.tsx')
assert 'Compte nominatif requis' in confirm
assert 'GOCMD_VALIDATION_KEY' not in source('.env.example')
print('PASS P5.15.29 : contrats API, UX, quatre yeux, visa nominatif et configuration')
