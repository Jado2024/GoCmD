"""Mesure reproductible de la requête de liste sur SQLite synthétique.
N'atteste ni une performance HTTP/Prisma ni le serveur Windows de SODEPI.
"""
import json
import sqlite3
import statistics
import time

N=100_000
c=sqlite3.connect(':memory:')
c.execute('CREATE TABLE "Order" (id INTEGER PRIMARY KEY, createdAt TEXT NOT NULL, ref TEXT NOT NULL, status TEXT NOT NULL)')
c.executemany('INSERT INTO "Order"(id,createdAt,ref,status) VALUES (?,?,?,?)',
  ((i, f'2026-11-{i%28+1:02d}T{i%24:02d}:{i%60:02d}:00.000Z',f'CMD-{i:08}', 'new') for i in range(1,N+1)))
c.commit()
query='SELECT id FROM "Order" ORDER BY "createdAt" DESC,"id" DESC LIMIT 50'
def test():
    times=[]
    for _ in range(35):
        t=time.perf_counter(); list(c.execute(query));times.append((time.perf_counter()-t)*1000)
    return {'p50_ms':round(statistics.median(times),3),'p95_ms':round(sorted(times)[int(len(times)*.95)-1],3),
            'plan':[row[3] for row in c.execute('EXPLAIN QUERY PLAN '+query)]}
before=test()
c.execute('CREATE INDEX "Order_createdAt_id_idx" ON "Order"("createdAt" DESC,"id" DESC)')
after=test()
assert any('TEMP B-TREE' in plan for plan in before['plan'])
assert any('Order_createdAt_id_idx' in plan for plan in after['plan'])
assert not any('TEMP B-TREE' in plan for plan in after['plan'])
print(json.dumps({'dataset':'100000 synthetic SQLite orders (in-memory)','before':before,'after':after,
                  'note':'Local SQLite only. Not Node, Prisma, network, HTTP, or industrial production.'},indent=2))
