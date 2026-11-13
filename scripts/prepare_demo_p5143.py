#!/usr/bin/env python3
"""GoCmd P5.14.3 — remise a niveau + reinitialisation ACHATS de DEMONSTRATION.

Migre puis repart d'un jeu de donnees fictives avec de nombreuses ruptures.
Effectue l'ensemble du travail sur une copie TEMPORAIRE et ne remplace la base
que si migrations, reset, controles FK et invariants sont tous reussis.
P5.14.6 : ferme explicitement toutes les connexions SQLite AVANT os.replace ;
sous Windows, un simple `with sqlite3.connect(...)` ne ferme pas la connexion.
AUCUNE SAUVEGARDE durable n'est creee. Les comptes et ventes sont conserves.
Arreter le serveur avant execution. Usage :
  python scripts/prepare_demo_p5143.py --db db/custom.db --apply
"""
from __future__ import annotations
import argparse
from contextlib import closing
import importlib.util
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STEPS = [
    ("P5.10 fournisseurs", "upgrade_suppliers_p510.py"),
    ("P5.11 sources de prix", "upgrade_sourcing_p511.py"),
    ("P5.12 consultations", "upgrade_consultations_p512.py"),
    ("P5.13 devis et documents", "upgrade_procurement_p513.py"),
    ("P5.13.1 prix/unites", "upgrade_safety_p5131.py"),
    ("P5.15.0 validation par ligne", "upgrade_da_line_approval_p5150.py"),
    ("P5.15.1 index audit DA", "upgrade_audit_indexes_p5151.py"),
]
PRESERVED = ["GoCmdUser", "Client", "Product", "Order", "OrderLine", "SalesQuote", "SalesInvoice", "SalesPayment"]
RESET_ZERO = ["PurchaseRequest", "SupplierRFQ", "SupplierConsultation", "SupplierQuoteOffer", "SupplierOrder", "GoodsReceipt", "SupplierInvoice"]


def load(script_name: str):
    path = ROOT / "scripts" / script_name
    if not path.is_file():
        raise RuntimeError(f"Script requis absent : {path}")
    module_name = "gocmd_p5143_" + path.stem
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Impossible de charger {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def table_names(conn):
    return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def counts(path: Path, table_list):
    with closing(sqlite3.connect(str(path))) as con:
        names = table_names(con)
        return {name: con.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
                for name in table_list if name in names}


def inspect(path: Path):
    with closing(sqlite3.connect(str(path))) as db:
        names = table_names(db)
        required = {'Material', 'Supplier', 'PurchaseRequest'}
        if not required.issubset(names):
            raise RuntimeError('Base non reconnue GoCmd : '+', '.join(sorted(required-names)))
        n = db.execute('SELECT COUNT(*) FROM Material').fetchone()[0]
        s = db.execute('SELECT COUNT(*) FROM Supplier').fetchone()[0]
        da = db.execute('SELECT COUNT(*) FROM PurchaseRequest').fetchone()[0]
        print(f'Base trouvee : {n} matieres, {s} fournisseurs, {da} DA')
        print('Tables consultations :', 'oui' if 'SupplierConsultation' in names else 'non')


def checks(path: Path, previous):
    with closing(sqlite3.connect(str(path))) as c:
        c.execute('PRAGMA foreign_keys=ON')
        names = table_names(c)
        for t in RESET_ZERO:
            if t not in names:
                raise RuntimeError(f'Table toujours absente : {t}')
            total = c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            if total:
                raise RuntimeError(f'Operations demo non nettoyees : {t} = {total}')
        for t, n in previous.items():
            count = c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            if count != n:
                raise RuntimeError(f'Donnee non-achats modifiee : {t} ({n} -> {count})')
        if c.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Integrite SQLite non valide')
        bad = c.execute('PRAGMA foreign_key_check').fetchall()
        if bad:
            raise RuntimeError('Cles etrangeres incoherentes : '+repr(bad[:3]))
        mat = c.execute('SELECT COUNT(*) FROM Material').fetchone()[0]
        supp = c.execute('SELECT COUNT(*) FROM Supplier').fetchone()[0]
        links = c.execute('SELECT COUNT(*) FROM SupplierMaterial').fetchone()[0]
        zero, low = c.execute('''SELECT
            SUM(CASE WHEN stockQty = 0 THEN 1 ELSE 0 END),
            SUM(CASE WHEN stockQty > 0 AND stockQty < minStock THEN 1 ELSE 0 END)
            FROM Material''').fetchone()
        zero, low = zero or 0, low or 0
        if mat < 55 or supp < 10 or zero < 15 or low < 15 or links < 70:
            raise RuntimeError(f'Demo insuffisante : mat={mat}, fournisseurs={supp}, rupture={zero}, sous_seuil={low}, liens={links}')
        cols={r[1] for r in c.execute('PRAGMA table_info("PurchaseRequestLine")')}
        if not {'approvedQty','approvalDecision','approvalReason','decisionBy','decisionAt'}.issubset(cols):
            raise RuntimeError('Migration P5.15.0 des validations de ligne absente')
        # All stocks correspond to available lots and placements; no artificial stock insertion.
        mismatched = c.execute('''SELECT m.id FROM Material m
            LEFT JOIN StockLot l ON l.materialId=m.id
            GROUP BY m.id
            HAVING ABS(m.stockQty-COALESCE(SUM(CASE WHEN l.status='available' THEN l.qty ELSE 0 END),0))>0.0001''').fetchall()
        if mismatched:
            raise RuntimeError('Stock incompatible avec les lots : '+repr(mismatched[:3]))
        print(f'CONTROLES OK : {mat} matieres, {supp} fournisseurs, {links} associations, {zero} ruptures, {low} sous seuil, DA/RFQ/BC a zero')
        print('Comptes/ventes conserves, lots coherents, FK et SQLite OK.')


def prepare(db_path: Path):
    if not db_path.is_file():
        raise RuntimeError(f'Base introuvable : {db_path}')
    # Le fichier temporaire n'est PAS une sauvegarde : il est supprime en cas d'echec,
    # puis remplace le fichier original atomiquement apres validation.
    fd, name = tempfile.mkstemp(prefix='.p5143_work_', suffix='.db', dir=str(db_path.parent))
    os.close(fd)
    work = Path(name)
    try:
        with closing(sqlite3.connect(str(db_path), timeout=30)) as original, closing(sqlite3.connect(str(work), timeout=30)) as copy:
            original.backup(copy)
        preserved = counts(work, PRESERVED)
        for label, script in STEPS:
            print('Migration :', label)
            module = load(script)
            fn = getattr(module, 'upgrade')
            fn(work)
        print('Reinitialisation des donnees fictives...')
        load('reinitialiser_demo_achats_p5132.py').run(work)
        checks(work, preserved)
        # Check again for connection locks; os.replace on Windows refuses if in use.
        try:
            os.replace(str(work), str(db_path))
        except PermissionError as exc:
            raise RuntimeError(
                'Windows refuse le remplacement de la base : ferme GoCmd '
                '(Ctrl+C), tous les serveurs Node/Bun qui utilisent custom.db, '
                'et les logiciels qui ouvrent cette base, puis relance la commande.'
            ) from exc
        print('P5.15.1 TERMINE : base reinitialisee. AUCUNE sauvegarde creee.')
    finally:
        if work.exists():
            try:
                work.unlink()
            except PermissionError:
                # Ne pas masquer l'erreur initiale ; en principe aucune connexion
                # SQLite au fichier de travail ne reste ouverte ici.
                print('AVERTISSEMENT : fichier de travail temporaire non supprimable : '+str(work), file=sys.stderr)


def main():
    p = argparse.ArgumentParser(description='Preparation complete GoCmd P5.14.3 DEMO (destructif, sans sauvegarde)')
    p.add_argument('--db', default='db/custom.db', help='Base SQLite a preparer')
    p.add_argument('--apply', action='store_true', help='Confirmer nettoyage des achats fictifs sans sauvegarde')
    args = p.parse_args()
    path = Path(args.db).expanduser().resolve()
    inspect(path)
    if not args.apply:
        print('LECTURE SEULE. Pour appliquer et effacer les achats fictifs : ajouter --apply')
        return
    prepare(path)

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('ECHEC :', e, file=sys.stderr)
        sys.exit(1)
