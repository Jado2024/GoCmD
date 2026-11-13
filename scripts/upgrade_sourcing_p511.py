"""GoCmd P5.11: migration SQLite additive, idempotente.

Avant: ARRETER GoCmd et sauvegarder db/custom.db.
Commande: python scripts/upgrade_sourcing_p511.py --db db/custom.db --apply
Ne convertit JAMAIS les tarifs indicatifs existants en contrats.
Les BC historiques gardent une source nulle, sans migration rétroactive artificielle.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import sqlite3

COLUMNS={
    "SupplierQuoteOffer":{
        "quoteRef":"TEXT", "validUntil":"DATETIME", "documentRef":"TEXT",
    },
    "SupplierOrderLine":{
        "priceSourceType":"TEXT", "priceSourceId":"INTEGER", "priceSourceRef":"TEXT",
    },
}
SQL='''CREATE TABLE IF NOT EXISTS "SupplierPriceAgreement" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "supplierId" INTEGER NOT NULL,
 "materialId" INTEGER NOT NULL,
 "contractRef" TEXT NOT NULL,
 "documentRef" TEXT NOT NULL,
 "unitPrice" DECIMAL NOT NULL,
 "currency" TEXT NOT NULL DEFAULT 'MAD',
 "validFrom" DATETIME NOT NULL,
 "validUntil" DATETIME NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending',
 "createdBy" TEXT NOT NULL,
 "approvedBy" TEXT,
 "approvedAt" DATETIME,
 "revokedBy" TEXT,
 "revokedAt" DATETIME,
 "revokeReason" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE
)'''
INDEXES=[
 '''CREATE UNIQUE INDEX IF NOT EXISTS "SupplierPriceAgreement_supplierId_materialId_contractRef_key" ON "SupplierPriceAgreement"("supplierId", "materialId", "contractRef")''',
 '''CREATE INDEX IF NOT EXISTS "SupplierPriceAgreement_supplierId_materialId_status_validUntil_idx" ON "SupplierPriceAgreement"("supplierId", "materialId", "status", "validUntil")''',
]
def upgrade(db_path:Path)->None:
    con=sqlite3.connect(db_path, timeout=30)
    try:
        con.execute("PRAGMA foreign_keys = ON")
        con.execute("PRAGMA busy_timeout = 30000")
        essential=["Supplier", "Material", "SupplierQuoteOffer", "SupplierOrderLine"]
        for table in essential:
            if not con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone():
                raise RuntimeError(f"Table absente: {table} — vérifiez la base / versions précédentes")
        counts={table:con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] for table in essential}
        con.execute("BEGIN IMMEDIATE")
        changed=[]
        for table,fields in COLUMNS.items():
            present={row[1] for row in con.execute(f'PRAGMA table_info("{table}")')}
            for name,ty in fields.items():
                if name not in present:
                    con.execute(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {ty}')
                    changed.append(f"{table}.{name}")
        con.execute(SQL)
        for index in INDEXES:con.execute(index)
        # Ne jamais convertir une ligne historique en accord tarifaire.
        if any(con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]!=count for table,count in counts.items()):
            raise RuntimeError("Nombre de lignes historique modifié")
        foreign=con.execute('PRAGMA foreign_key_check').fetchall()
        if foreign:raise RuntimeError(f'Foreign keys invalides : {foreign[:5]}')
        integrity=con.execute('PRAGMA integrity_check').fetchone()[0]
        if integrity!='ok':raise RuntimeError(f'Intégrité: {integrity}')
        con.commit()
        print('P5.11 OK | colonnes ajoutées :', ', '.join(changed) or 'déjà migrées', '| conservations:',counts,'| SQLite:',integrity)
    except Exception:
        con.rollback()
        raise
    finally:con.close()

if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--db',default='db/custom.db')
    ap.add_argument('--apply',action='store_true')
    a=ap.parse_args()
    path=Path(a.db).resolve()
    if not path.is_file():raise SystemExit(f'Base absente : {path}')
    if not a.apply:raise SystemExit('Aucune écriture : relancez avec --apply (après sauvegarde).')
    upgrade(path)
