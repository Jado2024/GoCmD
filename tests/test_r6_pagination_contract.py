"""R6: source-contract and SQLite scenario tests (NOT HTTP or Playwright)."""
from pathlib import Path
import sqlite3
import re

ROOT=Path(__file__).resolve().parents[1]
def source(rel): return (ROOT/rel).read_text(encoding='utf-8')
def check(name, condition):
    if not condition: raise AssertionError(name)
    print('PASS R6',name)

material_api=source('src/app/api/materials/route.ts')
da=source('src/components/erp/purchase-dialog.tsx')
orders_api=source('src/app/api/orders/route.ts')
orders_ui=source('src/components/erp/orders-view.tsx')
products_api=source('src/app/api/products/route.ts')
hooks=source('src/components/erp/hooks.ts')

check('DA recherche q serveur', 'q:materialSearch.trim()' in da and 'params.q' in hooks and 'ref:{contains:q}' in material_api)
check('DA pagination SQL et UI', 'skip:(page-1)*pageSize,take:pageSize' in material_api and 'setMaterialPage(p=>p+1)' in da)
check('DA garde matières achetables', 'purchasableOnly:true' in da and 'isPurchasable:true' in material_api and 'foamNature:"AGGLO"' in material_api)
check('DA filtres fournisseur côté serveur', 'supplierName?' in material_api and 'sharedSupplierIds' in material_api)
check('DA rechercher référence fournisseur sans filtre local de nom', 'supplierSku:{contains:q}' in material_api and 'includes(query)' not in da)
check('DA filtre active/historique complet côté serveur', 'daFilter==="active"' in material_api and 'daFilter==="without"' in material_api and 'da:daFilter' in da)
check('DA présence limitée aux matières de page et lignes choisies', 'ids=${daMaterialIds.join(",")}' in da and 'where:materialWhere' in source('src/app/api/materials/da-presence/route.ts'))
check('Commandes filtrées et paginées côté serveur', '{client:{name:{contains:q}}}' in orders_api and 'db.order.findMany({where,include' in orders_api and 'setOrderPage(p=>p+1)' in orders_ui)
check('Commandes: métadonnées globales sur serveur', 'db.order.count()' in orders_api and 'status:{in:["new","production","ready"]}' in orders_api and 'FROM "OrderLine" l INNER JOIN "Order" o' in orders_api)
check('Commandes: portefeuille UI issu agrégat', 'data?.summary.portfolio' in orders_ui and 'data?.summary.late' in orders_ui and 'data?.summary.total' in orders_ui)
check('Prix directeur page 25 et total indépendant', 'db.product.count({where})' in products_api and 'queuePageSize' in products_api and 'setPricePage(p=>p+1)' in orders_ui)
check('Contrôles de pagination invalides refusés', 'Pagination ou recherche de commandes invalide' in orders_api and 'Pagination des prix spéciaux invalide' in products_api)
check('Droits de lecture conservés', 'if(!mayRead)' in orders_api and 'hasPermission(req,"director.prices")' in products_api)

# Executed on an isolated in-memory SQLite backup, with 10,001 materials, 101 orders and 101 queued prices.
con=sqlite3.connect(':memory:')
source_con=sqlite3.connect(f'file:{ROOT / "db/custom.db"}?mode=ro',uri=True)
source_con.backup(con)
source_con.close()
con.execute('PRAGMA foreign_keys=ON')
clientId=con.execute('SELECT id FROM Client LIMIT 1').fetchone()[0]
productId=con.execute('SELECT id FROM Product LIMIT 1').fetchone()[0]
material_count=con.execute('SELECT count(*) FROM Material').fetchone()[0]
items=[('R6-MAT-%06d'%i,'R6 Recherche %06d'%i,'Mercerie','u',0.0) for i in range(1,10002-material_count)]
con.executemany('INSERT INTO Material (ref,name,category,unit,unitPrice) VALUES (?,?,?,?,?)',items)
check('SQLite synthétique > 10 000 matières', con.execute('SELECT count(*) FROM Material').fetchone()[0]>=10001)
check('SQLite recherche 10001e matière', len(con.execute('SELECT id FROM Material WHERE ref LIKE ?',('%'+items[-1][0]+'%',)).fetchall())==1)
for i in range(101):
    con.execute('INSERT INTO "Order"(ref,clientId,status) VALUES (?,?,?)',('R6-CMD-%05d'%i,clientId,'new'))
    oid=con.execute('SELECT last_insert_rowid()').fetchone()[0]
    con.execute('INSERT INTO "OrderLine"(orderId,productId,qty,unitPrice) VALUES (?,?,?,?)',(oid,productId,2.0,7.5))
check('SQLite 101 commandes',con.execute('SELECT count(*) FROM "Order"').fetchone()[0]==101)
check('SQLite page après 100e commande',len(con.execute('SELECT id FROM "Order" ORDER BY id DESC LIMIT 50 OFFSET 100').fetchall())==1)
portfolio=con.execute('SELECT SUM(l."qty" * l."unitPrice") FROM "OrderLine" l INNER JOIN "Order" o ON o."id" = l."orderId" WHERE o."status" IN (\'new\',\'production\',\'ready\') AND o."fulfillmentStatus" = \'open\'').fetchone()[0]
check('SQLite agrégat global distinct de page 50',abs(portfolio-(101*15.0))<1e-9)
# Use existing products for pricing queue without changing original database.
ids=[r[0] for r in con.execute('SELECT id FROM Product ORDER BY id LIMIT 101')]
con.executemany('UPDATE Product SET specialPriceStatus=?,status=?,specialNotes=?,isOrderScoped=0 WHERE id=?',[('pending','pending_validation','R6 test',i) for i in ids])
queue_total=con.execute('SELECT COUNT(*) FROM Product WHERE specialPriceStatus=? AND status=? AND specialNotes IS NOT NULL AND isOrderScoped=0',('pending','pending_validation')).fetchone()[0]
check('SQLite 101 tarifs en attente',queue_total>=101)
check('SQLite 5e page des prix',len(con.execute('SELECT id FROM Product WHERE specialPriceStatus=? AND status=? AND specialNotes IS NOT NULL AND isOrderScoped=0 ORDER BY createdAt,id LIMIT 25 OFFSET 100',('pending','pending_validation')).fetchall())>0)
check('SQLite garde intégrité sur scénario',con.execute('PRAGMA integrity_check').fetchone()[0]=='ok' and not con.execute('PRAGMA foreign_key_check').fetchall())
con.close()
print('R6 source contracts + 10k/101/101 SQLite scenarios PASS; HTTP and load timings NOT measured')
