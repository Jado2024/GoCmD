"""Migration P5.15.15 additive, transactionnelle, rejouable. Base SODEPI : faire backup d'abord.
Usage: python scripts/upgrade_phone_offers_p51515.py --db db/custom.db --apply
N'exécute jamais implicitement de migration sur la base active.
"""
import argparse
from pathlib import Path
import sqlite3

COLUMNS={
 'recordedBy':'TEXT',
 'buyerValidatedBy':'TEXT',
 'buyerValidatedAt':'DATETIME',
 'approvedBy':'TEXT',
 'approvedAt':'DATETIME',
}

def upgrade(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(path)
    con=sqlite3.connect(str(path),timeout=30)
    try:
        con.execute('PRAGMA foreign_keys=ON')
        con.execute('BEGIN IMMEDIATE')
        tables={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'SupplierQuoteOffer','AuditEvent'}.issubset(tables):
            raise RuntimeError('Schéma initial des offres ou des audits introuvable')
        before=con.execute('SELECT COUNT(*) FROM "SupplierQuoteOffer"').fetchone()[0]
        existing={r[1] for r in con.execute('PRAGMA table_info("SupplierQuoteOffer")')}
        for column,typ in COLUMNS.items():
            if column not in existing:
                con.execute(f'ALTER TABLE "SupplierQuoteOffer" ADD COLUMN "{column}" {typ}')
        con.execute('CREATE INDEX IF NOT EXISTS "SupplierQuoteOffer_buyerValidatedBy_idx" ON "SupplierQuoteOffer"("buyerValidatedBy")')
        assert con.execute('SELECT COUNT(*) FROM "SupplierQuoteOffer"').fetchone()[0]==before
        if con.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('Violation de clé étrangère')
        if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Intégrité SQLite en échec')
        con.commit()
        print('OK P5.15.15 : migration offres téléphoniques idempotente; lignes conservées:',before)
    except Exception:
        con.rollback();raise
    finally:con.close()

if __name__=='__main__':
    a=argparse.ArgumentParser()
    a.add_argument('--db',default='db/custom.db')
    a.add_argument('--apply',action='store_true')
    args=a.parse_args()
    if not args.apply:raise SystemExit('Aucune écriture : faire une sauvegarde puis ajouter --apply')
    upgrade(Path(args.db).resolve())
