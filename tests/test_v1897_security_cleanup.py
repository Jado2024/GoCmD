"""V18.9.7: source-level checks supplement, do not replace, live HTTP E2E."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
read=lambda f:(root/f).read_text(encoding='utf8')
qi=read('src/app/api/quality-inspections/route.ts')
ret=read('src/app/api/supplier-returns/route.ts')
sup=read('src/app/api/suppliers/route.ts')
assert 'canSeeMaterialCosts(req)' in qi and 'visibleCorrection' in qi
assert 'result.financialCorrection ? {required:true} : null' in qi
assert 'financialCorrection:visibleCorrection' in qi
assert 'canSeeMaterialCosts(req)' in ret and 'creditAllocations:[],allocatedCents:null' in ret
assert 'return {ref,id:returned.id,creditNotesConsumed' in ret
assert 'randomUUID()' in sup and 'supplier.count()' not in sup
assert 'FRN-${String(count+1)' not in sup
assert "'F04 quality must not receive supplier invoice or credit values'" in read('tests/http-v1892-remediation.cjs')
assert "'F05 allocation values must not leak to quality'" in read('tests/http-v1892-remediation.cjs')
print('PASS V18.9.7 — P1 financial-response redaction and collision-resistant supplier codes')
