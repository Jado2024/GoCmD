"""P5.13.1: additive migration for supplier price basis, on a stopped GoCmd server.
Never automatically infer or authorize the price basis of historical documents.
"""
from pathlib import Path
import argparse, sqlite3
COLUMNS={'priceBasis':'TEXT','priceBasisFactor':'REAL','sourceUnitPrice':'DECIMAL'}
TABLES=('SupplierQuoteOffer','SupplierPriceAgreement')

def upgrade(file:Path):
    db=sqlite3.connect(file,timeout=30)
    try:
        db.execute('PRAGMA foreign_keys=ON')
        before={t:db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in TABLES+('Supplier','Material','SupplierOrder','SupplierOrderLine')}
        # Explicit lock; no insertion or rewrite of existing quotes or contracts.
        db.execute('BEGIN IMMEDIATE')
        changed=[]
        for table in TABLES:
            existing={row[1] for row in db.execute(f'PRAGMA table_info("{table}")')}
            for name,kind in COLUMNS.items():
                if name not in existing:
                    db.execute(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {kind}')
                    changed.append(table+'.'+name)
        after={t:db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in before}
        if before!=after:raise RuntimeError('Counts changed during migration')
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('SQLite integrity check failed')
        db.commit()
        print('PASS P5.13.1 | colonnes:',', '.join(changed) or 'déjà présentes','| enregistrements conservés:',before)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--db',default='db/custom.db');p.add_argument('--apply',action='store_true')
    args=p.parse_args();path=Path(args.db)
    if not path.is_file():raise SystemExit('Base absente')
    if not args.apply:raise SystemExit('Migration bloquée : --apply requis après sauvegarde')
    upgrade(path)
