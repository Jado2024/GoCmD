#!/usr/bin/env python3
"""Test indépendant d'équivalence de tri SQL, sur BDD synthétique non métier.
Ne remplace pas une recette HTTP/Prisma Node 24.
"""
import random, sqlite3, statistics, time, os
random.seed(20261113)
c=sqlite3.connect(':memory:')
c.executescript('''
CREATE TABLE SupplierConsultation(id INTEGER PRIMARY KEY,ref TEXT,createdAt,deadline);
CREATE TABLE SupplierRFQ(id INTEGER PRIMARY KEY,materialId INTEGER,qty REAL,targetDate);
CREATE TABLE Material(id INTEGER PRIMARY KEY,stockQty REAL,minStock REAL);
CREATE TABLE SupplierConsultationLine(id INTEGER PRIMARY KEY,consultationId INTEGER,rfqId INTEGER);
CREATE INDEX l_cons ON SupplierConsultationLine(consultationId);
''')
for i in range(1,151):
 c.execute('INSERT INTO Material VALUES(?,?,?)',(i,random.choice([0,0.5,4,12,22]),10))
base=1790000000000
total_rows=int(os.environ.get("QWEN_ROWS","5000"))
for i in range(1,total_rows+1):
 due=None if i%13==0 else base+random.randrange(-7,15)*86400000
 if i%17==0 and due is not None:due=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(due/1000))
 c.execute('INSERT INTO SupplierConsultation VALUES(?,?,?,?)',(i,f'CONS-{i:06d}',base-i*120000,due))
 for j in range(0 if i%19==0 else random.randint(1,4)):
  r=i*5+j
  target=None if r%11==0 else base+random.randrange(-5,18)*86400000
  if r%23==0 and target is not None:target=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(target/1000))
  c.execute('INSERT INTO SupplierRFQ VALUES(?,?,?,?)',(r,random.randrange(1,151),random.choice([1,5,15]),target))
  c.execute('INSERT INTO SupplierConsultationLine VALUES(?,?,?)',(r,i,r))
c.commit()
soon=base+3*86400000
ms=lambda col:f"(CASE WHEN typeof({col}) IN ('integer','real') THEN {col} ELSE (julianday({col})-2440587.5)*86400000 END)"
deadline=ms('c.deadline');target=ms('r.targetDate')
lines='FROM SupplierConsultationLine l JOIN SupplierRFQ r ON r.id=l.rfqId JOIN Material m ON m.id=r.materialId'
oldline=lines+' WHERE l.consultationId=c.id'
score=f'CASE WHEN {target}<={soon} AND m.stockQty<r.qty THEN 0 WHEN m.stockQty<=0 THEN 1 WHEN m.stockQty>0 AND m.stockQty<m.minStock THEN 2 WHEN {target}<={soon} THEN 3 ELSE 4 END'
oldrank=f'min(coalesce((SELECT min({score}) {oldline}),4),CASE WHEN {deadline}<={soon} THEN 3 ELSE 4 END)'
old_due=f'min(coalesce({deadline},8640000000000000),coalesce((SELECT min({target}) {oldline}),8640000000000000))'
join=f'LEFT JOIN (SELECT l.consultationId,min({score}) lineRank,min({target}) firstTarget {lines} GROUP BY l.consultationId) gocmd_rank ON gocmd_rank.consultationId=c.id'
newrank=f'min(coalesce(gocmd_rank.lineRank,4),CASE WHEN {deadline}<={soon} THEN 3 ELSE 4 END)'
newdue=f'min(coalesce({deadline},8640000000000000),coalesce(gocmd_rank.firstTarget,8640000000000000))'
old=None
for typ in ['urgency','due_date']:
 for clause in ['','WHERE c.id%2=0','WHERE c.id>4900','WHERE c.ref LIKE "CONS-000%"']:
  for offset in [0,25,100,300]:
   first=f'{oldrank},{old_due}' if typ=='urgency' else f'{old_due},{oldrank}'
   second=f'{newrank},{newdue}' if typ=='urgency' else f'{newdue},{newrank}'
   one=f'SELECT c.id FROM SupplierConsultation c {clause} ORDER BY {first},{ms("c.createdAt")} DESC,c.id ASC LIMIT 40 OFFSET {offset}'
   two=f'SELECT c.id FROM SupplierConsultation c {join} {clause} ORDER BY {second},{ms("c.createdAt")} DESC,c.id ASC LIMIT 40 OFFSET {offset}'
   a=c.execute(one).fetchall();b=c.execute(two).fetchall()
   assert a==b,(typ,clause,offset,a[:4],b[:4])
   if typ=='urgency' and clause=='' and offset==0:old=(one,two)
print('PASS QWEN-P2P : 32x2 pages/tri équivalents, dates ISO/epoch/null, lignes vides')
for label,q in zip(['original corélé','nouveau groupe'],old):
 timings=[]
 for _ in range(8):
  st=time.perf_counter();c.execute(q).fetchall();timings.append((time.perf_counter()-st)*1000)
 print(f'{label}: médiane SQL {statistics.median(timings):.2f} ms ({total_rows:,} consultations, 8 runs)')
 for row in c.execute('EXPLAIN QUERY PLAN '+q).fetchall()[:6]:print('  ',row[-1])
