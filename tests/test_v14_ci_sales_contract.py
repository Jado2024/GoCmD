#!/usr/bin/env python3
"""Static prevention of the V13 CI/test contract regressions; runtime is covered by HTTP recipe."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
v12=(root/'tests/test_v12_concurrency.cjs').read_text()
v09=(root/'tests/test_v09_regression.cjs').read_text()
sales=(root/'tests/http-sales-recipe.cjs').read_text()
package=(root/'package.json').read_text()
assert "require('typescript')" in v12, 'typescript must resolve as a project devDependency'
assert "npm root" not in v12 and 'execFileSync' not in v12, 'do not depend on global npm installation'
assert "require('typescript')" in v09 and 'execFileSync' not in v09, 'old V09 fallback must not depend on global npm'
assert "assert.equal(view.status,'settled'" in sales, 'credit settlement is not full payment'
assert "simultaneous=await Promise.all" in sales, 'parallel same-piece delivery case missing'
assert "[201,409]" in sales, 'exactly one of two conflicting deliveries must succeed'
assert "new Set(pieceIdsDelivered).size,4" in sales, 'pieces must be unique across BL'
assert '"typescript"' in package, 'typescript devDependency not declared'
print('PASS V14: CI uses local TypeScript; invoice settled contract; double delivery parallel HTTP scenario present')
