"""P5.15.19: append-only extension for contract allocations in approved sourcing plans.
Never alters a supplier agreement, purchase order, or historical quote allocation.
Usage: python scripts/upgrade_award_contracts_p51519.py --db /path/to/COPY.db --apply
"""
import argparse
import sqlite3
from pathlib import Path

DDL = '''
CREATE TABLE IF NOT EXISTS "SupplierAwardContractAllocation" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "planId" INTEGER NOT NULL,
 "agreementId" INTEGER NOT NULL,
 "qty" REAL NOT NULL CHECK(qty > 0),
 "unitPrice" DECIMAL NOT NULL CHECK(unitPrice >= 0),
 CONSTRAINT "SupplierAwardContractAllocation_plan_fkey" FOREIGN KEY ("planId") REFERENCES "SupplierAwardPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierAwardContractAllocation_agreement_fkey" FOREIGN KEY ("agreementId") REFERENCES "SupplierPriceAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierAwardContractAllocation_plan_agreement_key" ON "SupplierAwardContractAllocation"("planId", "agreementId");
CREATE INDEX IF NOT EXISTS "SupplierAwardContractAllocation_agreement_idx" ON "SupplierAwardContractAllocation"("agreementId");
CREATE INDEX IF NOT EXISTS "SupplierPriceAgreement_material_status_validUntil_idx" ON "SupplierPriceAgreement"("materialId", "status", "validUntil");
'''

def upgrade(db_path: Path, apply: bool = False):
    if not db_path.is_file():
        raise ValueError('Base absente : aucune base créée automatiquement')
    conn = sqlite3.connect(f'file:{db_path.resolve()}?mode=rw', uri=True)
    try:
        conn.execute('PRAGMA foreign_keys=ON')
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Base non intègre avant migration')
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {'SupplierAwardPlan','SupplierQuoteOffer','SupplierPriceAgreement'}
        if not required.issubset(tables):
            raise ValueError('Migration préalable P5.15.18 manquante')
        if not apply:
            if conn.execute('PRAGMA foreign_key_check').fetchone():
                raise ValueError('Violations FK avant migration')
            return 'PRÉ-VÉRIFICATION OK : ajouter --apply pour migrer une copie sauvegardée'
        conn.executescript('BEGIN IMMEDIATE;\n' + DDL)
        if conn.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Violations FK après migration')
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Base non intègre après migration')
        conn.commit()
        return 'MIGRATION P5.15.19 OK (idempotente)'
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(upgrade(args.db, args.apply))
