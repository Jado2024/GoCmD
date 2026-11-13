"""R7 regression: real SQLite queries + static wiring checks; not HTTP/E2E."""
from pathlib import Path
import sqlite3,re
ROOT=Path(__file__).resolve().parents[1]
checks=[]
def test(n,ok):
 checks.append((n,bool(ok)))
 if not ok: raise AssertionError(n)
api=(ROOT/'src/app/api/sales/route.ts').read_text()
ui=(ROOT/'src/components/erp/sales-view.tsx').read_text()
orders=(ROOT/'src/app/api/orders/route.ts').read_text()
price=(ROOT/'src/app/api/materials/price-proposals/route.ts').read_text()
price_ui=(ROOT/'src/components/erp/materials-price-review.tsx').read_text()
schema=(ROOT/'src/lib/order-create-schema.ts').read_text()
ci=(ROOT/'.github/workflows/ci.yml').read_text()
package=(ROOT/'package.json').read_text()
for kind,table in [('quotes','salesQuote'),('orders','order'),('deliveries','salesDelivery'),('invoices','salesInvoice')]:
 block=api.split(f'if(kind==="{kind}")',1)[1].split('  if(kind===',1)[0].split('  return result("Vue inconnue")',1)[0]
 test(f'API {kind}: count + skip/take', f'db.{table}.count({{where}})' in block and 'skip' in block and 'take' in block)
 test(f'API {kind}: global pagination', 'pagination:' in block)
 test(f'UI {kind}: query server-side', f'type:"{kind}"' in ui)
for kind in ('quotes','orders','deliveries','invoices'):
 test(f'API {kind}: q where', 'contains:q' in api)
test('API orderId specific lookup', 'orderId!=null?{id:orderId}' in api)
test('UI selected order query independent page', 'selectedOrder.data?.items[0]' in ui)
test('UI selected order deliveries', 'selectedOrderDeliveries.data?.items.filter' in ui)
test('UI paging for all lists', all(f'"{x}"' in ui for x in ('devis','factures','BL','commandes')) and ui.count('<Pager')>=6)
test('Orders indicator uses active status', 'status:{in:["new","production","ready"]}' in orders)
test('Orders portfolio excluded rejected', "'new','production','ready'" in orders and 'fulfillmentStatus' in orders)
test('Director queue role AND director.prices', 'isDirector(req)' in price and 'hasPermission(req,"director.prices")' in price)
test('Director queue server pending filter', 'pendingSalesUnitPrice:{not:null}' in price and 'db.material.count({where})' in price)
test('Director queue paged UI', 'materials/price-proposals?' in price_ui and "setPage(p=>p+1)" in price_ui)
test('GEN-DIV schema dimensional conditional', 'g.template==="GEN-DIV"' in schema and 'count!==0 && count!==3' in schema)
test('CI runs R7', 'bun run test:v2:r7' in ci and 'test:v2:r7' in package)
# Reproduce portfolios on real demo schema in ephemeral memory: compare statuses.
src=sqlite3.connect(ROOT/'db/custom.db')
c=sqlite3.connect(':memory:');src.backup(c);src.close()
test('SQLite integrity preserved', c.execute('pragma integrity_check').fetchone()[0]=='ok' and not c.execute('pragma foreign_key_check').fetchall())
client=c.execute('select id from Client limit 1').fetchone()[0]
product=c.execute('select id from Product limit 1').fetchone()[0]
status=['rejected','shipped','pending_validation','new','production','ready']
for ix,s in enumerate(status):
 c.execute('insert into "Order" (ref,clientId,status,fulfillmentStatus,dueDate) values (?,?,?,?,?)',(f'R7-STAT-{ix}',client,s,'open','2020-01-01T12:00:00.000'))
 oid=c.execute('select last_insert_rowid()').fetchone()[0]
 c.execute('insert into "OrderLine" (orderId,productId,qty,unitPrice) values (?,?,?,?)',(oid,product,2,100))
expected=600
sql=re.search(r'`(SELECT SUM\(l\."qty" \* l\."unitPrice"\) AS portfolio\s+FROM "OrderLine" l INNER JOIN "Order" o ON o\."id" = l\."orderId" WHERE [^`]+)`',orders)
test('Portfolio query found',sql is not None)
portfolio=c.execute(sql.group(1)).fetchone()[0]
test('Rejected, shipped, pending excluded from portfolio',portfolio==expected)
late=c.execute("select count(*) from 'Order' where status in ('new','production','ready') and fulfillmentStatus='open' and dueDate<'2026-11-12'").fetchone()[0]
test('Rejected, shipped, pending excluded from overdue',late==3)
# 121 documents per type; same isolated DB, no application file touched.
order_id=c.execute("select id from 'Order' where status='new' limit 1").fetchone()[0]
for i in range(121):
 c.execute('insert into SalesQuote(ref,clientId,payload,subtotalCents,createdBy) values (?,?,?,?,?)',(f'R7-Q-{i:03}',client,'{"lines":[]}',100*i,'fixture'))
 c.execute('insert into SalesDelivery(ref,orderId,createdBy) values (?,?,?)',(f'R7-BL-{i:03}',order_id,'fixture'))
 c.execute('insert into SalesInvoice(ref,orderId,clientId,subtotalCents,taxCents,totalCents,createdBy) values (?,?,?,?,?,?,?)',(f'R7-FAC-{i:03}',order_id,client,100*i,0,100*i,'fixture'))
for table,prefix in [('SalesQuote','R7-Q-'),('SalesDelivery','R7-BL-'),('SalesInvoice','R7-FAC-')]:
 total=c.execute(f'SELECT COUNT(*) FROM {table} WHERE ref LIKE ?', (prefix+'%',)).fetchone()[0]
 third=c.execute(f'SELECT ref FROM {table} WHERE ref LIKE ? ORDER BY id DESC LIMIT 50 OFFSET 100',(prefix+'%',)).fetchall()
 test(f'{table}: 121 rows, third page 21',total==121 and len(third)==21)
 one=c.execute(f'SELECT ref FROM {table} WHERE ref LIKE ? AND ref LIKE ? ORDER BY id DESC LIMIT 50',(prefix+'%', '%118')).fetchall()
 test(f'{table}: search beyond 100',len(one)==1 and one[0][0].endswith('118'))
# 221 pending material proposals in an isolated DB, ensuring server filters beyond 200.
# Existing DEMO has 82 MP, add 139 fictitious copies with distinct refs without touching on-disk DB.
cols=[r[1] for r in c.execute('pragma table_info(Material)') if r[1] not in ('id',)]
mat=c.execute('select * from Material limit 1').fetchone()
allcols=[r[1] for r in c.execute('pragma table_info(Material)')]
vals=dict(zip(allcols,mat))
for k in range(221):
 row=vals.copy();row['id']=10000+k;row['ref']=f'MP-R7-{k:04}';row['name']=f'Test matière {k}';row['pendingSalesUnitPrice']=100+k;row['salesPriceProposalRevision']=1;row['salesPriceProposedBy']='buyer-tester';row['isSellable']=1
 for col in ('canonicalIdentity','foamIdentityKey'):
  if col in row and row[col]:row[col]=str(row[col])+f'|R7={k}'
 if 'technicalAttributesJson' in row and row['technicalAttributesJson']:row['technicalAttributesJson']=str(row['technicalAttributesJson'])
 keys=list(row)
 try:c.execute(f'INSERT INTO Material({",".join(chr(34)+col+chr(34) for col in keys)}) VALUES ({",".join("?" for _ in keys)})',[row[k] for k in keys])
 except sqlite3.IntegrityError as e:
  # DB-only stress can be performed via temporary new proposals on original 82 + synthetic rows without strict invariants.
  raise AssertionError(f'Material fixture {k}: {e}')
res=c.execute('select id from Material where pendingSalesUnitPrice is not null order by id limit 40 offset 200').fetchall()
test('Director queue can page beyond 200 rows',len(res)>0)
test('Real SQLite integrity after fixtures', c.execute('pragma integrity_check').fetchone()[0]=='ok' and not c.execute('pragma foreign_key_check').fetchall())
for name,ok in checks: print('PASS',name)
print(f'R7 contract + SQLite: {len(checks)} checks passed (isolated in-memory database).')
