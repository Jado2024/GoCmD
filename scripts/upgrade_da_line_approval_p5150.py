#!/usr/bin/env python3
"""Migration additive P5.15.0 : decisions par ligne de DA, sans purge.

NE PAS utiliser `prisma db push` : migration SQLite explicite, idempotente.
Usage : python scripts/upgrade_da_line_approval_p5150.py --db db/custom.db --apply
"""
from __future__ import annotations
import argparse
import sqlite3
from contextlib import closing
from pathlib import Path

FIELDS = {
    'approvedQty': 'REAL NOT NULL DEFAULT 0',
    'approvalDecision': "TEXT NOT NULL DEFAULT 'pending'",
    'approvalReason': 'TEXT',
    'decisionBy': 'TEXT',
    'decisionAt': 'DATETIME',
}


def upgrade(db_path: Path):
    if not db_path.is_file():
        raise RuntimeError(f'Base absente : {db_path}')
    with closing(sqlite3.connect(str(db_path), timeout=30)) as c:
        c.execute('PRAGMA busy_timeout=30000')
        c.execute('PRAGMA foreign_keys=ON')
        names={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'PurchaseRequest', 'PurchaseRequestLine','AuditEvent'}.issubset(names):
            raise RuntimeError('Schema GoCmd non compatible ou migration de base prealable manquante')
        columns={r[1] for r in c.execute('PRAGMA table_info("PurchaseRequestLine")')}
        # Ne migrer les historiques QUE lors de la premiere apparition des champs.
        fresh='approvedQty' not in columns
        try:
            c.execute('BEGIN IMMEDIATE')
            for field, type_sql in FIELDS.items():
                if field not in columns:
                    c.execute(f'ALTER TABLE "PurchaseRequestLine" ADD COLUMN "{field}" {type_sql}')
            if fresh:
                # Les DA deja validees par l'ancien logiciel portaient une autorisation globale
                # de toutes les quantites ; reproduire exactement cet etat a la migration.
                c.execute('''UPDATE "PurchaseRequestLine"
                    SET approvedQty=qty,
                        approvalDecision='approved',
                        decisionBy=(SELECT approvedBy FROM PurchaseRequest WHERE id=requestId),
                        decisionAt=(SELECT approvedAt FROM PurchaseRequest WHERE id=requestId)
                    WHERE requestId IN (SELECT id FROM PurchaseRequest
                    WHERE status IN ('approved','ordered','partial','received','closed'))''')
                c.execute('''UPDATE "PurchaseRequestLine"
                    SET approvedQty=0, approvalDecision='rejected'
                    WHERE requestId IN (SELECT id FROM PurchaseRequest WHERE status IN ('cancelled','rejected'))''')
            faulty=c.execute('''SELECT id FROM PurchaseRequestLine
                WHERE approvedQty < 0 OR approvedQty > qty + 0.000001''').fetchall()
            if faulty: raise RuntimeError(f'Lignes incoherentes, aucune migration appliquee : {faulty[:3]}')
            fk=c.execute('PRAGMA foreign_key_check').fetchall()
            if fk: raise RuntimeError(f'Clés étrangères invalides : {fk[:3]}')
            c.execute('COMMIT')
        except BaseException:
            c.execute('ROLLBACK')
            raise
        print('P5.15.0 MIGRATION OK : champs decisions lignes presents, historiques conserves, FK OK.')


def main():
    parser=argparse.ArgumentParser(description='Migration additive GoCmd P5.15.0')
    parser.add_argument('--db',default='db/custom.db')
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    path=Path(args.db).expanduser().resolve()
    if not args.apply:
        print('LECTURE SEULE : pour migrer la base, ajouter --apply')
        return
    upgrade(path)

if __name__=='__main__': main()
