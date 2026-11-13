"""Migration idempotente de la table Material, sans réinitialiser la base.

Utilisation Windows :
  python scripts/upgrade_foam_catalogue_p55.py --db db/custom.db --apply
Les anciennes matières fictives sont conservées, non reclassifiées automatiquement.
"""
import argparse
from pathlib import Path
import sqlite3

COLUMNS = {
    'description':'TEXT',
    'foamColor':'TEXT',
    'foamFirmness':'TEXT',
    'foamResilience':'REAL',
    'foamSupplierGrade':'TEXT',
    'foamLengthCm':'REAL',
    'foamWidthCm':'REAL',
    'foamHeightCm':'REAL',
    'foamThicknessCm':'REAL',
    'foamIdentityKey':'TEXT',
}

def upgrade(db_file: Path):
    con=sqlite3.connect(str(db_file),timeout=30)
    try:
        con.execute('PRAGMA busy_timeout=30000')
        if con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='Material'").fetchone() is None:
            raise RuntimeError('Table Material introuvable ; mauvaise base SQLite')
        con.execute('BEGIN IMMEDIATE')
        existing={row[1] for row in con.execute('PRAGMA table_info("Material")')}
        added=[]
        for column,typ in COLUMNS.items():
            if column not in existing:
                con.execute(f'ALTER TABLE "Material" ADD COLUMN "{column}" {typ}')
                added.append(column)
        # NULL est accepté plusieurs fois par SQLite ; les fiches antérieures
        # restent consultables sans identité technique inventée.
        con.execute('CREATE UNIQUE INDEX IF NOT EXISTS "Material_foamIdentityKey_key" ON "Material"("foamIdentityKey")')
        con.commit()
        print('P5.5 — Migration terminée. Colonnes ajoutées:',', '.join(added) if added else 'aucune (déjà à jour)')
        print('Intégrité:',con.execute('PRAGMA integrity_check').fetchone()[0])
        print('Matières existantes:',con.execute('SELECT COUNT(*) FROM "Material"').fetchone()[0])
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()

if __name__=='__main__':
    a=argparse.ArgumentParser()
    a.add_argument('--db',default='db/custom.db')
    a.add_argument('--apply',action='store_true')
    args=a.parse_args()
    database=Path(args.db).resolve()
    if not database.is_file():
        raise SystemExit(f'Base introuvable: {database}')
    if not args.apply:
        raise SystemExit('Mode aperçu : relancer avec --apply pour migrer la base.')
    upgrade(database)
