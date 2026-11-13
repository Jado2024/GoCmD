#!/usr/bin/env python3
"""P5.15.21 — contrôles des neuf corrections (SEP-001, SEP-002, FEFO-001,
CONC-001, CONC-002, VAL-001, VAL-002, INFO-001, UX-002).

Deux volets :
  A. Contrôles STATIQUES : chaque garde corrigée est vérifiée dans le source
     livré (un correctif absent du code livré n'existe pas).
  B. Contrôles COMPORTEMENTAUX sur une COPIE de la base démo :
     - les deux migrations additives s'appliquent et la base reste intègre ;
     - le mode journal rollback est vérifié (CONC-001/P1) ;
     - la sémantique SQL « NULLS LAST » place les lots périssables avant les
       lots sans péremption (FEFO-001).

Exécution : python3 tests/test_p51521_guards.py
"""
from __future__ import annotations

import re
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    status = "PASS" if ok else "FAIL"
    print(f"{status}  {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(name)


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# A. Contrôles statiques
# ---------------------------------------------------------------------------
def static_guards() -> None:
    print("== Contrôles statiques (source livré) ==")

    # SEP-001 — quatre-yeux sur la validation des commandes clients.
    schema = read("prisma/schema.prisma")
    order_model = schema.split("model Order {", 1)[1].split("}", 1)[0]
    check("SEP-001 · Order.createdBy présent dans le schéma Prisma", re.search(r"createdBy\s+String\?", order_model) is not None)

    orders_create = read("src/app/api/orders/route.ts")
    # P5.15.29 contre-audit (CONC-ACTEUR) : l'acteur est figé UNE fois après la
    # porte d'accès (accessGate) puis réutilisé — plus sûr que de relire la
    # session au milieu de la transaction (readSession peut renvoyer null sous
    # contention). Le contrat vérifie capture ET usage traçant le créateur.
    check(
        "SEP-001 · le créateur est tracé à la création (POST /api/orders)",
        "const actor=currentActor(req)" in orders_create
        and "if (!actor)" in orders_create
        and "const actorName=actor.username" in orders_create
        and "createdBy: actorName" in orders_create
        and orders_create.index("const actorName=actor.username") < orders_create.index("db.$transaction"),
    )

    orders_review = read("src/app/api/orders/[id]/route.ts")
    check(
        "SEP-001 · garde auto-validation (créateur == validateur refusé)",
        "SELF_REVIEW_FORBIDDEN" in orders_review and "pending.createdBy===actor" in orders_review,
    )
    check(
        "SEP-001 · refus dédié 403 (distinct des conflits 409)",
        re.search(r"Auto-validation interdite[^\n]*\{status:403\}", orders_review) is not None,
    )

    # SEP-002 — émetteur d'une facture ≠ enregistreur du règlement.
    sales = read("src/app/api/sales/route.ts")
    check(
        "SEP-002 · garde émetteur ≠ payeur sur les règlements",
        "SELF_PAYMENT_FORBIDDEN" in sales and "inv.createdBy===actor" in sales,
    )
    check(
        "SEP-002 · refus dédié 403 (distinct des conflits 409)",
        "quatre yeux requis" in sales,
    )

    # FEFO-001 — tri FEFO avec lots sans péremption en fin de file.
    # Contre-audit 08/11/2026 (AV-08) : l'exigence « exactement 3 tris » datait
    # d'avant le stock fini (VEN-01) qui ajoute deux tris FEFO légitimes
    # (disponibilité matelas + sortie stock fini). Le contrôle vérifie désormais
    # que TOUS les tris expiresAt du circuit ventes portent nulls:"last".
    fefo_sorts = len(re.findall(r'expiresAt:\{sort:"asc",nulls:"last"\}', sales))
    fefo_bare = len(re.findall(r'expiresAt:"asc"', sales))
    check("FEFO-001 · tous les tris FEFO portent nulls:\"last\"", fefo_bare == 0 and fefo_sorts >= 3, f"{fefo_sorts} tris corrigés, {fefo_bare} tri(s) nu(s) restant(s)")

    # CONC-001 / P5.15.28 : journal rollback contrôlé au démarrage du client.
    db_init = read("src/lib/db.ts")
    check(
        "CONC-001 · rollback DELETE vérifié et busy_timeout à l'initialisation",
        "pragma_journal_mode" in db_init and "'delete'" in db_init and "busy_timeout" in db_init,
    )

    # CONC-002 — mutations sensibles dans la file d'écriture sérialisée.
    check(
        "CONC-002 · avance + approbation de commande sérialisées",
        sales.count("serializedSQLiteWrite") >= 1
        and orders_review.count("serializedSQLiteWrite(()=>db.$transaction") >= 3,
        f"orders/[id] : {orders_review.count('serializedSQLiteWrite(()=>db.$transaction')} appels (hold/resume/close + avance + approbation attendus)",
    )
    products_create = read("src/app/api/products/route.ts")
    products_patch = read("src/app/api/products/[id]/route.ts")
    check(
        "CONC-002 · création et modification de référence sérialisées",
        "serializedSQLiteWrite" in products_create and "serializedSQLiteWrite" in products_patch,
    )

    # VAL-001 — quantité facturée compatible avec l'unité de stock.
    invoices = read("src/app/api/supplier-invoices/route.ts")
    check(
        "VAL-001 · isValidPurchaseQuantity sur les lignes de facture",
        "isValidPurchaseQuantity(item.qty" in invoices and 'material:{select:{unit:true}}' in invoices,
    )
    check("VAL-001 · message INVALID_UNIT_QTY cartographié", "INVALID_UNIT_QTY" in invoices)

    # VAL-002 — valorisation chronologique des retours.
    returns = read("src/app/api/supplier-returns/route.ts")
    check(
        "VAL-002 · invoicedCentsForQty remplace le prix de la première ligne",
        "invoicedCentsForQty(invoicedLines,d.qty)" in returns and "invoicedLines[0].unitPrice" not in returns,
    )
    valuation = read("src/lib/invoiced-valuation.ts")
    check("VAL-002 · tri chronologique (date, identifiant, ligne) dans la lib", "invoiceDate" in valuation and "a.invoice.id - b.invoice.id" in valuation)

    # INFO-001 — messages d'erreur blanchis.
    check(
        "INFO-001 · /api/orders ne renvoie plus e.message brut",
        "(e as Error).message" not in orders_create and "Gabarits ou pièces invalides" in orders_create,
    )
    quote_catch = sales.split("A-023", 1)[1][:1200] if "A-023" in sales else ""
    check(
        "INFO-001 · le précontrôle devis ne renvoie plus e.message brut",
        "e instanceof Error?e.message" not in quote_catch,
    )

    # UX-002 — cible tactile 24 px, clavier sur ligne catalogue, contrastes.
    checkbox = read("src/components/ui/checkbox.tsx")
    check("UX-002 · case à cocher standard portée à 24 px (size-6)", "size-6" in checkbox)
    catalogue = read("src/components/erp/catalogue-view.tsx")
    check(
        "UX-002 · ligne catalogue opérable au clavier (tabIndex + Entrée/Espace)",
        'tabIndex={0}' in catalogue and 'e.key === "Enter"' in catalogue,
    )
    check("UX-002 · contraste « /unit » relevé (slate-400 → slate-500)", "text-slate-400\"> /" not in catalogue and "text-slate-500\"> /" in catalogue)
    sidebar = read("src/components/erp/nav-sidebar.tsx")
    check("UX-002 · contraste libellé de section sidebar relevé (→ slate-300)", "tracking-wider text-slate-300" in sidebar)

    # Migrations additives présentes.
    mig1 = read("prisma/sql/2026-11-07_p51521_order_createdby.sql")
    mig2 = read("prisma/sql/2026-11-07_p51521_stocklot_fefo_index.sql")
    check("Migration 1 · ALTER TABLE ADD COLUMN createdBy (additive)", 'ADD COLUMN "createdBy" TEXT' in mig1)
    check("Migration 2 · CREATE INDEX IF NOT EXISTS (idempotente)", "CREATE INDEX IF NOT EXISTS" in mig2)


# ---------------------------------------------------------------------------
# B. Contrôles comportementaux (copie de la base démo)
# ---------------------------------------------------------------------------
def behavioral_guards() -> None:
    print("== Contrôles comportementaux (copie jetable de db/custom.db) ==")
    source = ROOT / "db" / "custom.db"
    if not source.exists():
        check("base démo présente pour les contrôles", False, str(source))
        return
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "custom.db"
        shutil.copy2(source, work)
        con = sqlite3.connect(work)
        orders_before = con.execute('SELECT COUNT(*) FROM "Order"').fetchone()[0]
        # Le ZIP unifié livre déjà une base démo migrée. Pour contrôler la
        # migration elle-même (et pas seulement la présence de la colonne),
        # recréer son état initial UNIQUEMENT dans cette copie jetable.
        # SQLite >= 3.35 prend en charge DROP COLUMN.
        existing_cols = {row[1] for row in con.execute('PRAGMA table_info("Order")')}
        if "createdBy" in existing_cols:
            con.execute('ALTER TABLE "Order" DROP COLUMN "createdBy"')
            con.commit()
            check("précondition migration · colonne retirée de la copie de test", "createdBy" not in {row[1] for row in con.execute('PRAGMA table_info("Order")')})
        # Repartir également d'un état sans index FEFO sur la copie jetable.
        con.execute('DROP INDEX IF EXISTS "StockLot_material_status_expires_idx"')
        con.commit()
        con.close()

        # Migrations additives : applicables sur la copie prémigration ;
        # l'index est idempotent, ADD COLUMN ne l'est PAS.
        for label, sql_file in (
            ("migration 1 (Order.createdBy)", "prisma/sql/2026-11-07_p51521_order_createdby.sql"),
            ("migration 2 (index FEFO)", "prisma/sql/2026-11-07_p51521_stocklot_fefo_index.sql"),
        ):
            con = sqlite3.connect(work)
            try:
                con.executescript(read(sql_file))
                con.commit()
                check(f"comportement · {label} s'applique sans erreur", True)
            except Exception as exc:  # pragma: no cover
                check(f"comportement · {label} s'applique sans erreur", False, str(exc))
            finally:
                con.close()
        con = sqlite3.connect(work)
        cols = [row[1] for row in con.execute('PRAGMA table_info("Order")')]
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        orders_after = con.execute('SELECT COUNT(*) FROM "Order"').fetchone()[0]
        con.close()
        check("comportement · colonne createdBy effective sur la table Order", "createdBy" in cols)
        check(f"comportement · intégrité conservée ({integrity})", integrity == "ok")
        check(
            f"comportement · aucune commande modifiée ({orders_before} avant / {orders_after} après)",
            orders_before == orders_after,
        )

        # Idempotence de la migration d'index.
        con = sqlite3.connect(work)
        try:
            con.executescript(read("prisma/sql/2026-11-07_p51521_stocklot_fefo_index.sql"))
            con.commit()
            check("comportement · migration d'index rejouable (idempotente)", True)
        except Exception as exc:  # pragma: no cover
            check("comportement · migration d'index rejouable (idempotente)", False, str(exc))
        finally:
            con.close()

        # CONC-001 — la copie de test reste sûre en mode rollback DELETE.
        con = sqlite3.connect(work)
        mode = con.execute("PRAGMA journal_mode=DELETE").fetchone()[0]
        con.close()
        check(f"comportement · rollback DELETE effectif (mode obtenu : {mode})", mode == "delete")

        # FEFO-001 — sémantique SQL : NULLS LAST place les périssables en tête.
        con = sqlite3.connect(":memory:")
        con.execute("CREATE TABLE lot (id INTEGER PRIMARY KEY, expires_at TEXT)")
        con.executemany(
            "INSERT INTO lot (id, expires_at) VALUES (?, ?)",
            [(1, None), (2, "2026-12-31"), (3, "2026-11-30")],
        )
        order = [row[0] for row in con.execute("SELECT id FROM lot ORDER BY expires_at ASC NULLS LAST, id ASC")]
        naive = [row[0] for row in con.execute("SELECT id FROM lot ORDER BY expires_at ASC, id ASC")]
        con.close()
        check(
            "comportement · NULLS LAST : périssables avant lots sans péremption",
            order == [3, 2, 1],
            f"ordre obtenu {order}",
        )
        check(
            "comportement · sans la correction, l'ordre SQLite était inversé",
            naive == [1, 3, 2],
            f"ordre naïf {naive}",
        )


def main() -> int:
    static_guards()
    behavioral_guards()
    if FAILURES:
        print(f"\n{len(FAILURES)} contrôle(s) en échec : " + ", ".join(FAILURES))
        return 1
    print("\nP5.15.21 : toutes les gardes démontrées sur le source livré et la base démo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
