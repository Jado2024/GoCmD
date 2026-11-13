"""Migration additive et idempotente GoCmd P5.10 (fournisseurs).

Exécuter GoCmd arrêté :
 python scripts/upgrade_suppliers_p510.py --db db/custom.db --apply
L'option --apply est explicite. Aucun fournisseur/commande n'est modifié.
"""
import argparse
import sqlite3
from pathlib import Path

COLUMNS = {
    'city': 'TEXT', 'country': 'TEXT', 'ice': 'TEXT', 'taxId': 'TEXT',
    'tradeRegister': 'TEXT', 'paymentTerms': 'TEXT',
}

def upgrade(db_path: Path):
    con=sqlite3.connect(db_path,timeout=30)
    try:
        con.execute('PRAGMA busy_timeout=30000')
        con.execute('PRAGMA foreign_keys=ON')
        if not con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Supplier'").fetchone():
            raise RuntimeError('Table Supplier absente (mauvaise base SQLite)')
        before=con.execute('SELECT COUNT(*) FROM Supplier').fetchone()[0]
        con.execute('BEGIN IMMEDIATE')
        existing={r[1] for r in con.execute('PRAGMA table_info("Supplier")')}
        added=[]
        for name, typ in COLUMNS.items():
            if name not in existing:
                con.execute(f'ALTER TABLE "Supplier" ADD COLUMN "{name}" {typ}')
                added.append(name)
        con.commit()
        after=con.execute('SELECT COUNT(*) FROM Supplier').fetchone()[0]
        integrity=con.execute('PRAGMA integrity_check').fetchone()[0]
        if before!=after or integrity!='ok':
            raise RuntimeError('Contrôle de conservation échoué')
        print('P5.10 OK - colonnes:',', '.join(added) if added else 'déjà présentes',
              '| fournisseurs conservés:',after,'| intégrité:',integrity)
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()

if __name__=='__main__':
    arg=argparse.ArgumentParser()
    arg.add_argument('--db',default='db/custom.db')
    arg.add_argument('--apply',action='store_true')
    a=arg.parse_args()
    database=Path(a.db).resolve()
    if not database.is_file():
        raise SystemExit(f'Base introuvable : {database}')
    if not a.apply:
        raise SystemExit('Aucune modification : ajoutez --apply pour migrer la base.')
    upgrade(database)
