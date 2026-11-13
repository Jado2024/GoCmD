"""Offline schema/SQLite shape sanity check; NOT Prisma schema validate or compile."""
import pathlib,re,sqlite3
root=pathlib.Path(__file__).resolve().parents[1]
s=(root/'prisma/schema.prisma').read_text()
c=sqlite3.connect(root/'db/custom.db')
models=re.findall(r'^model\s+(\w+)\s*\{(.*?)^\}',s,re.MULTILINE|re.DOTALL)
scalar={'String','Int','Float','Decimal','DateTime','Boolean','BigInt','Bytes','Json'}
errors=[]
for name,body in models:
 cols={r[1] for r in c.execute(f'PRAGMA table_info("{name}")').fetchall()}
 if not cols:errors.append((name,'table missing'));continue
 for line in body.splitlines():
  parts=line.strip().split()
  if len(parts)<2 or parts[0].startswith(('//','@@','@')):continue
  typ=parts[1].replace('?','').replace('[]','')
  if typ in scalar and parts[0] not in cols:errors.append((name,parts[0]))
print('MODELS',len(models),'ERRORS',errors[:30]);assert not errors,errors
assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
print('PASS: all scalar Prisma fields exist in the migrated SQLite schema (static sanity)')
