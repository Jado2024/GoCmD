#!/usr/bin/env python3
"""Verification LECTURE SEULE de la base avant de demarrer GoCmd.
Si une migration manque, refuse le demarrage et indique la commande explicite.
Ne modifie jamais la base cible (ouverture SQLite URI mode=ro).
"""
import argparse, pathlib, sqlite3, os, sys
REQUIRED={'approvedQty','approvalDecision','approvalReason','decisionBy','decisionAt'}

def inspect_db(path):
    p=pathlib.Path(path).expanduser().resolve()
    if not p.is_file(): raise RuntimeError(f'Base introuvable: {p}')
    with sqlite3.connect(p.as_uri()+'?mode=ro',uri=True) as c:
        tables={x[0] for x in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        need_tables={'Material','Product','PurchaseRequest','PurchaseRequestLine','SupplierOrder','GoodsReceipt','AuditEvent'}
        if need_tables-tables: raise RuntimeError('Tables GoCmd manquantes: '+', '.join(sorted(need_tables-tables)))
        cols={r[1] for r in c.execute('PRAGMA table_info(PurchaseRequestLine)')}
        if REQUIRED-cols: raise RuntimeError('Colonnes approbation DA manquantes: '+', '.join(sorted(REQUIRED-cols))+' ; commande: python scripts/upgrade_da_line_approval_p5150.py --db "'+str(p)+'" --apply')
        if 'SupplierAwardContractAllocation' not in tables:
            raise RuntimeError('Migration P5.15.19 manquante. Après sauvegarde, exécuter : '
                               'python scripts/upgrade_award_contracts_p51519.py --db "'+str(p)+'" --apply')
        # P5.15.21 (DEF-V-02) : le circuit ventes (création CMD -> OF automatiques,
        # stock fini, retours clients) exige les tables ventes de la RC. Sans elles,
        # toute création de commande échoue en P2021 au moment de l'OF. Refuser le
        # démarrage avec la commande explicite plutôt qu'un 409 à la première vente.
        sales_tables={'WorkOrder':'upgrade_work_orders_p51521.py --db "<base>" --apply --backup "<sauvegarde externe>"',
                      'FinishedStockLot':'upgrade_finished_stock_p51521.py --db "<base>" --apply',
                      'FinishedStockMovement':'upgrade_finished_stock_p51521.py --db "<base>" --apply',
                      'FinishedStockAllocation':'upgrade_finished_stock_p51521.py --db "<base>" --apply',
                      'CustomerReturn':'upgrade_customer_returns_p51521.py --db "<base>" --apply',
                      'SalesCreditNoteLine':'upgrade_sales_credit_lines_p51521.py --db "<base>" --apply'}
        missing_sales=sorted(t for t in sales_tables if t not in tables)
        if missing_sales:
            raise RuntimeError('Migration P5.15.21 manquante (tables ventes : '+', '.join(missing_sales)+'). '
                               'Après sauvegarde externe, exécuter dans l\'ordre : '
                               + ' ; '.join('python scripts/'+sales_tables[t] for t in missing_sales))
        if 'FinishedStockReservation' not in tables or 'preparationKind' not in {x[1] for x in c.execute('PRAGMA table_info(WorkOrder)')}:
            raise RuntimeError('Migration P5.15.23 des réservations de matelas manquante. Après sauvegarde, exécuter : '
                               'python scripts/upgrade_finished_reservations_p51523.py --db "'+str(p)+'" --apply')
        # P5.15.26 : les OF stock et le registre de reception sont obligatoires.
        mts_tables={'ProductionReplenishmentRequest','ProductionStockOrder','ProductionMaterialReceipt'}
        missing_mts=mts_tables-tables
        if missing_mts:
            raise RuntimeError('Migration production stock P5.15.26 manquante ('+', '.join(sorted(missing_mts))+'). '
               'Appliquer dans l ordre, sur copie sauvegardee : '
               'python scripts/upgrade_replenishment_p51525.py --db "<base>" --apply ; '
               'python scripts/upgrade_production_mts_p51526.py --db "<base>" --apply')
        guards={x[0] for x in c.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
        required_guards={'gocmd_mts_receipt_immutable','gocmd_mts_receipt_no_delete','gocmd_mts_of_no_delete','gocmd_finished_receipt_immutable_update','gocmd_finished_receipt_immutable_delete','gocmd_finished_lot_provenance_immutable'}
        if required_guards-guards:
            raise RuntimeError('Protections MTS manquantes : appliquer upgrade_production_mts_p51526.py avec sauvegarde')
        if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise RuntimeError('SQLite integrity_check non OK')
        if c.execute('PRAGMA foreign_key_check').fetchall(): raise RuntimeError('SQLite foreign_key_check non OK')
    print(f'PASS P5.15.7 schema et integrite SQLite: {p}')

if __name__=='__main__':
    a=argparse.ArgumentParser()
    a.add_argument('--db', default=os.environ.get('GOCMD_DB_FILE','db/custom.db'))
    args=a.parse_args()
    try: inspect_db(args.db)
    except Exception as e:
        print('BLOCAGE DE DEMARRAGE : '+str(e),file=sys.stderr);sys.exit(2)
