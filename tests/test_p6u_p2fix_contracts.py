#!/usr/bin/env python3
"""P6U-P2FIX focused contracts. Mostly source contracts; not a replacement for Windows/HTTP E2E."""
from pathlib import Path
import json
import sqlite3
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
count = 0

def source(name):
    return (ROOT / name).read_text(encoding='utf-8')

def verify(label, condition):
    global count
    if not condition:
        raise AssertionError(label)
    count += 1
    print('PASS', label)


def main():
    sales=source('src/app/api/orders/route.ts')
    approve=source('src/app/api/orders/[id]/route.ts')
    verify('Commandes obligatoirement validées', 'return "pending_validation"' in source('src/lib/commercial-authorization.ts'))
    verify('Aucun OF au POST commande', 'await createMissingWorkOrders(' not in sales)
    verify('OF seulement au PATCH approbation', 'if (action === "approve") await createMissingWorkOrders(tx, oid, actor)' in approve)
    verify('Acteur vérifié une fois par requête', 'const actorIdentity=currentActor(req)' in approve and 'currentActor(req)!' not in approve)
    verify('Quatre yeux', 'SELF_REVIEW_FORBIDDEN' in approve)
    for f in ('tests/e2e/sales-circuit.spec.ts','tests/sc-recette-ventes-p51521.cjs','tests/sc-recette-ventes-p51523.cjs','tests/http-sales-recipe.cjs','tests/audit-anti-fuites-sodepi-20261110.cjs'):
        x=source(f)
        verify(f+' recette prend en compte attente / validation',
               ('pending_validation' in x and ('action:\'approve\'' in x or 'action:"approve"' in x)))
    e2e=source('tests/e2e/sales-circuit.spec.ts')
    verify('Playwright teste absence OF avant visa', 'before.json()).items).toHaveLength(0)' in e2e)
    verify('Playwright teste refus auto approbation', 'expect(forbidden.status()).toBe(403)' in e2e)
    verify('Approbateur différent fourni au navigateur', "APPROVER: ['approver']" in source('tests/run-e2e-playwright.cjs'))
    doc=source('src/app/api/p2p/offer-documents/[id]/route.ts')
    verify('Consultation PDF journalisée en file SQLite', 'serializedSQLiteWrite(()=>db.auditEvent.create(' in doc)
    verify('Consultation PDF fail-closed si audit indisponible', "status:503" in doc)
    fk=source('scripts/verify_sqlite_runtime.py')
    verify('Indicateurs FK honnêtes', 'foreign_key_check_passed' in fk and 'foreign_keys_connection_note' in fk and "'foreign_keys': 0" not in fk)
    install=source('deploy/windows/installer-service.ps1')
    health=source('deploy/windows/verifier-sante.ps1')
    verify('Identité service explicitement appliquée', 'sc.exe config $serviceName obj=' in install and 'StartName -ine $ServiceAccount' in install)
    verify('Service non privilégié', "NT AUTHORITY\\LocalService" in install and "IsInRole" in install)
    verify('WinSW explicite LocalService sans secret', '<serviceaccount>' in source('deploy/windows/gocmd-service.xml') and '<username>NT AUTHORITY\\LocalService</username>' in source('deploy/windows/gocmd-service.xml'))
    verify('Four daily backup triggers present', all('New-ScheduledTaskTrigger -Daily -At '+repr(h) in install for h in ('00:00','06:00','12:00','18:00')))
    verify('Backup task registered and verified', "Register-ScheduledTask -TaskName 'GoCmd-Sauvegarde'" in install and 'LastTaskResult -ne 0' in install)
    verify('Daily supervision scheduled', "Register-ScheduledTask -TaskName 'GoCmd-Sante'" in install)
    verify('Backup procedure validates archive', '--verify-only' in source('deploy/windows/executer-sauvegarde.ps1'))
    verify('Unexpected service stop is critical', 'Arrêt INATTENDU' in health and 'if (-not $serviceRunning -and $svc -and $dbOk -and $plannedMaintenance)' in health)
    verify('Maintenance marker restricted by admin', 'IsInRole' in source('deploy/windows/maintenance-controlee.ps1') and 'expiresUtc' in health)
    verify('Bitlocker or explicit acknowledgment required', 'Get-BitLockerVolume' in install and 'EncryptionVerifiedByAdministrator' in install)
    verify('CI protects P2FIX', 'tests/test_p6u_p2fix_contracts.py' in source('.github/workflows/ci.yml'))
    verify('Demo database intact', (lambda c: c.execute('PRAGMA integrity_check').fetchone()[0]=='ok' and c.execute('PRAGMA foreign_key_check').fetchone() is None and c.execute('SELECT COUNT(*) FROM "Order"').fetchone()[0]==0)(sqlite3.connect(f'file:{(ROOT/"db/custom.db").resolve().as_posix()}?mode=ro',uri=True)))
    result=subprocess.run([sys.executable,str(ROOT/'scripts/verify_sqlite_runtime.py'),'--db',str(ROOT/'db/custom.db')],capture_output=True,text=True)
    telemetry=json.loads(result.stdout or '{}')
    verify('Telemetry DB consistent and truthfully scoped',result.returncode==0 and telemetry.get('foreign_key_check_passed') is True and 'foreign_keys_connection_note' in telemetry)
    print(f'P6U P2FIX: {count}/{count} contrats ciblés PASS (statiques + contrôle SQLite réel)')

if __name__ == '__main__':
    main()
