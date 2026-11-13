"""V18.3 non-runtime guardrails. Complements typed/build/HTTP validation, never replaces it."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
read = lambda p: (root / p).read_text(encoding="utf-8")

finance = read('src/lib/supplier-invoice-balance.ts')
assert finance.count('.reduce<number>(') == 2, 'Both financial reductions must accumulate in numeric cents'

routes = [
    'src/app/api/purchases/route.ts',
    'src/app/api/purchases/[id]/route.ts',
    'src/app/api/supplier-orders/route.ts',
    'src/app/api/supplier-orders/[id]/route.ts',
    'src/app/api/goods-receipts/route.ts',
]
for route in routes:
    content = read(route)
    assert content.count('await serializedSQLiteWrite(() => db.$transaction(') == 1, route
    assert 'import { serializedSQLiteWrite } from "@/lib/sqlite-write"' in content, route

order = read('src/app/api/supplier-orders/[id]/route.ts')
assert 'if(lastRevision?.actor===actor)throw new Error("REVISER_SELF_APPROVAL")' in order
assert 'Le dernier révisateur ne peut pas approuver sa propre révision du BC.' in order
assert 'if(old.createdBy && old.createdBy===actor)throw new Error("SELF_APPROVAL")' in order

scripts = json.loads(read('package.json'))['scripts']
assert scripts['test:regression'].startswith('npm run test:types && ')
assert 'tsc --noEmit' in scripts['test:types']
assert 'test:v183' in scripts['test:regression:runtime']
assert 'test:v182' in scripts['test:regression:runtime']

print('PASS V18.3: finance generic, P2P write queue 5/5, four-eyes message, regression type gate')
