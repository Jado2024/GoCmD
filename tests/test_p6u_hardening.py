#!/usr/bin/env python3
"""Non-régression P6U-P1FIX sur code + SQLite fictive.
Statique et tests de migration réels seulement ; ne remplace pas HTTP/Windows.
"""
import json
import sqlite3
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

R=Path(__file__).resolve().parents[1]
results=[]
def ok(label,value):
    results.append((label,bool(value)))
    print(('PASS' if value else 'FAIL'),label)
def read(name):return (R/name).read_text(encoding='utf8')

def main():
    orders=read('src/app/api/orders/route.ts')
    review=read('src/app/api/orders/[id]/route.ts')
    calc=read('src/lib/commercial-authorization.ts')
    work=read('src/lib/work-order-create.ts')
    ui=read('src/components/erp/orders-view.tsx')
    ok('CMD standard et spéciale initialement en attente', 'return "pending_validation"' in calc and 'return needsPrice||needsTechnical' not in calc)
    ok('Création CMD sans émission OF', 'await createMissingWorkOrders(' not in orders)
    ok('Visas tarifaires distincts du visa commercial', 'Si aucune personnalisation technique ni produit provisoire : confirmation directe' not in review and 'Le visa du directeur approuve UNIQUEMENT les prix' in review)
    ok('Approbation de CMD standard autorisée', 'NO_TECHNICAL_REVIEW' not in review)
    ok('Quatre yeux sur approbation', 'SELF_REVIEW_FORBIDDEN' in review and 'pending.createdBy===actor' in review)
    ok('Emission OF transactionnelle après validation', 'if (action === "approve") await createMissingWorkOrders(tx, oid, actor)' in review)
    ok('Garde OF contre commandes non approuvées', 'ORDER_NOT_APPROVED' in work and 'order.reviewedBy===order.createdBy' in work.replace(' ', ''))
    ok('Garde avance CMD non approuvée', 'Commande non approuvée par un responsable indépendant' in review)
    ok('Bouton responsable pour TOUTES les CMD en attente', 'detail.status==="pending_validation" && <div' in ui and 'detail.lines.some(l=>l.technicalReviewRequired||l.product.status==="pending_validation")' not in ui)
    xml=ET.fromstring(read('deploy/windows/gocmd-service.xml'))
    tax=next(e.get('value') for e in xml.findall('env') if e.get('name')=='GOCMD_SALES_TAX_RATES_BPS')
    ok('Aucun taux TVA actif dans gabarit production', tax=='')
    installer=read('deploy/windows/installer-service.ps1')
    health=read('deploy/windows/verifier-sante.ps1')
    ok('Installateur fournit le chemin SQLite', 'verify_sqlite_runtime.py' in installer and '--db $DbFile' in installer)
    ok('Supervision fournit le chemin SQLite', 'python $py --db $DbFile' in health)
    ok('Supervision /api/health = 204', '/api/health' in health and 'StatusCode -eq 204' in health and 'status:204' in read('src/app/api/health/route.ts'))
    ok('Supervision différencie arrêt volontaire et panne HTTP', 'if ($serviceRunning) {' in health and 'HTTP non testé : service Windows à l\'arrêt' in health)
    ok('Node minimum commun service, lanceur et CI', 'nodeMajor -lt 24' in installer and 'nodeMajor<24' in read('scripts/start-gocmd-checked.cjs') and "node-version: '24'" in read('.github/workflows/ci.yml'))
    ok('Alerte sauvegarde au-delà de 12h', 'if ($ageH -gt 12)' in health)
    ok('Migration emploie API backup SQLite', 'reader.backup(destination)' in read('scripts/upgrade_reservation_engagement_p6.py') and 'shutil.copyfile' not in read('scripts/upgrade_reservation_engagement_p6.py'))
    # Exercices de migration sur une base fictive distincte du ZIP livré
    with tempfile.TemporaryDirectory(prefix='p6u-migrate-') as d:
        db=Path(d)/'source.db'; c=sqlite3.connect(db)
        c.executescript('CREATE TABLE SalesStockReservation (id INTEGER PRIMARY KEY, createdAt DATETIME);'
                        'CREATE TABLE FinishedStockReservation (id INTEGER PRIMARY KEY);'
                        "INSERT INTO SalesStockReservation(createdAt) VALUES ('2026-09-01T00:00:00Z');")
        c.commit();c.close()
        cmd=[sys.executable,str(R/'scripts/upgrade_reservation_engagement_p6.py'),'--db',str(db),'--apply']
        p=subprocess.run(cmd,capture_output=True,text=True,timeout=15)
        ok('Migration réelle sur base fictive',p.returncode==0)
        backups=list(Path(d).glob('*.avant_anciennete_p6_*.db'))
        ok('Snapshot SQLite présent',len(backups)==1)
        if backups:
            with sqlite3.connect(backups[0]) as c:
                ok('Snapshot initial intègre, sans colonnes nouvelles',c.execute('PRAGMA integrity_check').fetchone()[0]=='ok' and 'engagedAt' not in [v[1] for v in c.execute('PRAGMA table_info(SalesStockReservation)')])
        with sqlite3.connect(db) as c:
            ok('Migration conserve les événements précédents',c.execute('SELECT engagedAt FROM SalesStockReservation').fetchone()[0]=='2026-09-01T00:00:00Z')
            ok('Migration intègre',c.execute('PRAGMA integrity_check').fetchone()[0]=='ok')
    with sqlite3.connect(f'file:{(R/"db/custom.db").resolve().as_posix()}?mode=ro',uri=True) as c:
        ok('Base démo livrée intacte',c.execute('SELECT count(*) FROM "Order"').fetchone()[0]==0 and c.execute('PRAGMA integrity_check').fetchone()[0]=='ok' and c.execute('PRAGMA foreign_key_check').fetchone() is None)
    print(f"P6U HARDENING {sum(v for _,v in results)}/{len(results)}")
    if not all(v for _,v in results):raise SystemExit(1)
if __name__=='__main__':main()
