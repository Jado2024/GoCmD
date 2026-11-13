#!/usr/bin/env python3
"""P5.15.21 (DEF-V-02) — régression : le démarrage refusé sans tables ventes.

Preuve d'exécution du contre-audit du 08/11/2026 : la procédure CI de la RC
n'appliquait pas la migration WorkOrder ; toute création de commande tombait
alors en 409 (P2021 table WorkOrder absente) dès la conversion d'un devis.
Le garde-fou de démarrage doit désormais refuser explicitement une base non
migrée, avec la commande de remédiation, et accepter la base livrée.
"""
import pathlib, sqlite3, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
GUARD = ROOT / 'scripts' / 'check_sqlite_schema_p5157.py'
SOURCE = ROOT / 'db' / 'custom.db'

def run_guard(db):
    return subprocess.run([sys.executable, str(GUARD), '--db', str(db)],
                          capture_output=True, text=True)

def main():
    assert SOURCE.is_file(), 'base de démonstration absente'
    # 1. La base livrée doit passer le garde-fou (tables ventes P5.15.21 présentes).
    ok = run_guard(SOURCE)
    assert ok.returncode == 0, f'la base livrée doit être migrée P5.15.21 : {ok.stderr}'
    assert 'PASS' in ok.stdout, ok.stdout
    print('PASS : base livrée migrée P5.15.21 (OF, stock fini, retours, avoirs)')

    # 2. Une base sans table WorkOrder doit être refusée avec la commande exacte.
    with tempfile.TemporaryDirectory() as tmp:
        target = pathlib.Path(tmp) / 'unmigrated.db'
        con = sqlite3.connect(SOURCE)
        try:
            with sqlite3.connect(target) as dst:
                con.backup(dst)
        finally:
            con.close()
        with sqlite3.connect(target) as c:
            c.execute('DROP TABLE "WorkOrder"')
        bad = run_guard(target)
        assert bad.returncode == 2, f'code inattendu {bad.returncode} : {bad.stdout}{bad.stderr}'
        assert 'WorkOrder' in bad.stderr, bad.stderr
        assert 'upgrade_work_orders_p51521.py' in bad.stderr, 'commande de remédiation absente : ' + bad.stderr
        print('PASS : démarrage refusé sur base sans OF, remédiation explicite')

        # 3. Une base sans stock fini (retours/avoirs) doit aussi être refusée.
        with sqlite3.connect(target) as c:
            c.execute('DROP TABLE "CustomerReturn"')
            c.execute('DROP TABLE "SalesCreditNoteLine"')
        bad2 = run_guard(target)
        assert bad2.returncode == 2, f'code inattendu {bad2.returncode}'
        assert 'CustomerReturn' in bad2.stderr and 'SalesCreditNoteLine' in bad2.stderr, bad2.stderr
        print('PASS : démarrage refusé sans tables retours/avoirs, remédiation explicite')

    print('PASS P5.15.21 DEF-V-02 : garde-fou de démarrage ventes vérifié (3/3)')

if __name__ == '__main__':
    main()
