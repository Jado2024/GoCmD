"""Tests indépendants de DB et garde-fous sources, sans dépendances Node."""
import pathlib, sqlite3, shutil, tempfile, subprocess, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
def read(p):return (ROOT/p).read_text()
def check(ok,msg):
 assert ok,msg
 print('PASS',msg)

with tempfile.TemporaryDirectory() as t:
    db=pathlib.Path(t)/'test.db'
    shutil.copy2(ROOT/'db/custom.db',db)
    for idx in range(2):
        r=subprocess.run([sys.executable,str(ROOT/'scripts/apply_director_price_upgrade_v1895.py'),'--db',str(db),'--apply'],capture_output=True,text=True)
        check(r.returncode==0,'migration idempotente '+str(idx+1))
    with sqlite3.connect(db) as c:
        cols={i[1] for i in c.execute('pragma table_info(Product)')}
        required={'specialPriceStatus','specialApprovedUnitPrice','specialPriceProposedBy','specialPriceApprovedBy','specialPriceApprovedAt','specialPriceDecisionReason','specialPriceRevision'}
        check(required<=cols,'7 colonnes prix directeur présentes')
        check(c.execute('PRAGMA integrity_check').fetchone()[0]=='ok','SQLite integrity_check')
        check(not c.execute('PRAGMA foreign_key_check').fetchall(),'SQLite foreign_key_check')
        c.execute("UPDATE Product SET specialNotes='Sur mesure pour un client particulier',status='pending_validation',unitPrice=234.0 WHERE id=(SELECT min(id) FROM Product)")
        c.execute("UPDATE Product SET specialPriceStatus='pending' WHERE id=(SELECT min(id) FROM Product)")
        c.commit()
        check(c.execute("SELECT count(*) FROM Product WHERE specialPriceStatus='pending'").fetchone()[0]>=1,'prix spécial pending persiste')

access=read('src/lib/access-gate.ts')
check('actor.roles.includes("director")' in access,'rôle directeur explicite')
check('actor.roles.includes("admin")||actor.roles.includes("director")' not in access,'pas de délégation tacite à admin')
route=read('src/app/api/products/[id]/director-price/route.ts')
for action in ['SPECIAL_PRICE_APPROVED','SPECIAL_PRICE_REJECTED','SPECIAL_PRICE_PROPOSED','serializedSQLiteWrite','specialPriceProposedBy===actor','linked.some','specialApprovedUnitPrice']:
 check(action in route,'route tarif contient '+action)
orders=read('src/app/api/orders/[id]/route.ts')
check('DIRECTOR_PRICE_REQUIRED' in orders and 'action==="approve"' in orders,'approbateur commande ne contourne pas le prix directeur')
quotes=read('src/app/api/sales/route.ts')
# AUDIT P5.15.27-A (resynchronisation, cf. precedent AN-01..AN-06 P5.15.23) :
# la garde tarifaire du devis est desormais exercee a la creation (ecart refusé)
# ET a l'envoi (SPECIAL_PRICE_CHANGED) ; l'approbation de commande garde
# "Prix spécial non approuvé". Intention conservee et renforcee.
check('SPECIAL_PRICE_CHANGED' in quotes and 'Prix du produit spécial différent de la proposition enregistrée' in quotes,'devis bloque le prix spécial sans visa')
patch=read('src/app/api/products/[id]/route.ts')
check('existing.specialNotes && parsed.data.unitPrice !== undefined' in patch,'ancien PATCH prix impossible')
check('director' in read('scripts/create-user.cjs'),'provisionnement des comptes director')
helper=read('src/lib/special-price.ts')
check('isExactMADPrice' in helper and 'isSameAuthorizedPrice' in helper,'prix exact au centime et comparaison sûre')
check('isSameAuthorizedPrice' in read('src/app/api/orders/route.ts'),'prix ordre ne contourne pas les décimales')
check('isSameAuthorizedPrice' in read('src/app/api/sales/route.ts'),'prix devis et livraison ne contournent pas les décimales')
check('specialPriceStatus:"approved"' in read('src/app/api/products/route.ts'),'produit spécial approuvé accessible pour devis commercial')
print('PASS V18.9.5 — contrôles DB et garde-fous structurels')
