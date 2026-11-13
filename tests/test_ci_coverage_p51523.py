"""P5.15.23 — empêcher l'omission silencieuse des régressions et des SC-13..15.
Test sans dépendances externes, sans écriture en base.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
scripts = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['scripts']
ci = (ROOT / '.github/workflows/ci.yml').read_text(encoding='utf-8')
chunks = (ROOT / 'scripts/run-regression-chunks.sh').read_text(encoding='utf-8')

missing_historic = [
    'test:v18913p56', 'test:v18913p57', 'test:v18913p58',
    'test:v18913p59', 'test:v18913p510', 'test:v18913p511',
    'test:v18913p512', 'test:v18913p513', 'test:v18913p5131',
    'test:v18913p5132', 'test:v18913p5133',
]
assert 'test:regression:runtime' in scripts['test:regression']
assert 'bun run test:regression' in ci
commands = scripts['test:regression:runtime'].split(' && ')
for name in missing_historic:
    assert commands.count(f'npm run {name}') == 1, f'missing/duplicate canonical regression: {name}'
positions = [commands.index('npm run ' + name) for name in missing_historic]
assert positions == sorted(positions), 'regression history is out of order'
assert commands.index('npm run test:v18913p55') < positions[0]
assert positions[-1] < commands.index('npm run test:v18913p5147')
assert 'bun run test:sc-ventes:p51523' in ci, 'SC-13..15 absent from blocking CI'
assert 'bun run test:commercial:sodepi' in ci, 'Commercial contracts missing from blocking CI'
assert 'bun run test:security:closure' in ci, 'Security closure missing from blocking CI'
assert 'bun run test:work-orders:p51521' in ci, 'Historic OF contract missing from CI'
assert 'test:sc-ventes:p51523' in scripts
assert 'cd /home/z/my-project/gocmd' not in chunks
assert '$(dirname "${BASH_SOURCE[0]}")/..' in chunks
assert 'run_step "v18913p5132" bun run test:v18913p5132' in chunks
assert 'exit "$code"' in chunks, 'chunk runner must propagate non-zero status'
print('PASS P5.15.23 CI coverage: 11/11 historical steps + SC-13..15 + portable fail-fast chunks')
