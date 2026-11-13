#!/usr/bin/env python3
"""P5.15.12/P5.15.13 — Non-régression AN-CPL-01 : triggers de réservation et péremption.

Reproduit le défaut corrigé : sur P5.15.11, datetime(expiresAt) sur un entier
epoch-ms renvoie NULL (jour julien) → tout lot AVEC péremption voyait sa
réservation refusée (RAISE ABORT RESERVATION_EXCEEDS_LOT) puis remontait en
« Conflit de données » trompeur (Prisma P2003, constraint null).

Ce test installe les triggers du script de migration corrigé sur une base
éphémère et vérifie :
  1. réservation OK sur lot avec péremption FUTURE (epoch ms)
  2. réservation refusée sur lot PÉRIMÉ (garde péremption conservée)
  3. réservation OK sur lot sans péremption (cas nominal historique)
  4. sur-réservation refusée (garde quantité conservée)
  5. source du script de migration sans la comparaison défectueuse datetime()
     (P5.15.13 : la signature exacte du défaut P5.15.11 est ciblée ; la forme
      durcie P5.15.13 réintroduit datetime() uniquement pour les dates TEXTE,
      sous discrimination typeof — couverte exhaustivement par
      tests/test_p51513_reservation_expiry_hardened.py)

Exécution : python tests/test_p51512_reservation_expiry.py (aucune base réelle touchée).
"""
import pathlib, sqlite3, sys, tempfile, time, os

HERE = pathlib.Path(__file__).resolve().parent
UPGRADE = HERE.parent / "scripts" / "upgrade_sales_reservation_p5154.py"

SCHEMA = """
CREATE TABLE "Product" ("id" INTEGER PRIMARY KEY, "materialId" INTEGER NOT NULL);
CREATE TABLE "OrderLine" ("id" INTEGER PRIMARY KEY, "productId" INTEGER NOT NULL REFERENCES "Product"("id"));
CREATE TABLE "StockLot" ("id" INTEGER PRIMARY KEY, "materialId" INTEGER NOT NULL,
  "qty" REAL NOT NULL, "status" TEXT NOT NULL, "expiresAt" INTEGER);
CREATE TABLE "SalesStockReservation" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "orderLineId" INTEGER NOT NULL REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "stockLotId" INTEGER NOT NULL REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "qty" REAL NOT NULL CHECK("qty" > 0),
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("orderLineId","stockLotId")
);
INSERT INTO "Product" VALUES (1, 7);
INSERT INTO "OrderLine" VALUES (10, 1), (11, 1), (12, 1);
"""

def load_fixed_ddl():
    text = UPGRADE.read_text(encoding="utf-8")
    # P5.15.13 : la garde durcie réutilise datetime() pour les dates TEXTE sous
    # discrimination typeof ; le défaut P5.15.11 ciblé est la comparaison SANS
    # discrimination, qui échouait (NULL) sur les entiers epoch-ms de Prisma.
    defect_signature = '(l."expiresAt" IS NULL OR datetime(l."expiresAt")>datetime(\'now\'))'
    assert defect_signature not in text, \
        "le script de migration contient encore la comparaison défectueuse datetime() sans discrimination typeof"
    assert 'typeof(l."expiresAt")' in text, \
        "la garde de péremption durcie P5.15.13 (discrimination typeof) est absente"
    # importe la liste DDL du script de migration (safe : argparse sous __main__)
    import importlib.util
    spec = importlib.util.spec_from_file_location("upgrade_p5154_src", UPGRADE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    triggers = [s for s in mod.DDL if "gocmd_p5154_reservation_insert" in s or "gocmd_p5154_reservation_update" in s]
    assert len(triggers) == 2, f"2 triggers attendus dans le script, trouvé {len(triggers)}"
    # retire le IF NOT EXISTS (base éphémère vierge, on veut une erreur si existant)
    return [t.replace("CREATE TRIGGER IF NOT EXISTS", "CREATE TRIGGER", 1) for t in triggers]

def main():
    ddl = load_fixed_ddl()
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="gocmd_p51512_")) / "scratch.db"
    con = sqlite3.connect(str(tmp))
    con.executescript(SCHEMA)
    for stmt in ddl:
        con.execute(stmt)
    con.commit()

    now_ms = int(time.time() * 1000)
    FUTURE = now_ms + 90 * 24 * 3600 * 1000   # +90 jours (epoch ms)
    PAST = now_ms - 24 * 3600 * 1000          # périmé hier (epoch ms)
    con.executemany("INSERT INTO \"StockLot\" VALUES (?,?,?,?,?)", [
        (64, 7, 2.0, "available", FUTURE),   # lot AVEC péremption future
        (66, 7, 5.0, "available", PAST),      # lot PÉRIMÉ
        (68, 7, 10.0, "available", None),     # lot SANS péremption
    ])
    con.commit()

    results = []
    def check(name, cond, detail=""):
        results.append((name, cond, detail))
        print(("PASS " if cond else "FAIL ") + name + (f" | {detail}" if detail and not cond else ""))

    # 1. Réservation sur lot avec péremption FUTURE → OK (défaut P5.15.11)
    try:
        con.execute("INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (10, 64, 2.0, 't1')")
        con.commit()
        check("péremption future : réservation acceptée", True)
    except sqlite3.IntegrityError as e:
        check("péremption future : réservation acceptée", False, str(e))

    # 2. Réservation sur lot PÉRIMÉ → refus (garde conservée)
    try:
        con.execute("INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (11, 66, 1.0, 't2')")
        con.commit()
        check("lot périmé : réservation refusée", False, "insertion acceptée à tort")
    except sqlite3.IntegrityError as e:
        check("lot périmé : réservation refusée", "RESERVATION_EXCEEDS_LOT" in str(e), str(e))

    # 3. Réservation sur lot SANS péremption → OK (nominal historique)
    try:
        con.execute("INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (12, 68, 7.0, 't3')")
        con.commit()
        check("sans péremption : réservation acceptée", True)
    except sqlite3.IntegrityError as e:
        check("sans péremption : réservation acceptée", False, str(e))

    # 4. Sur-réservation sur le lot 68 (7/10 déjà réservés, +4 refusé) → garde quantité
    cur = con.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='gocmd_p5154_reservation_update'")
    if cur.fetchone()[0]:
        try:
            con.execute("UPDATE SalesStockReservation SET qty = 11 WHERE createdBy='t3'")
            con.commit()
            check("sur-réservation : refusée (garde quantité)", False, "mise à jour acceptée à tort")
        except sqlite3.IntegrityError as e:
            check("sur-réservation : refusée (garde quantité)", "RESERVATION_EXCEEDS_LOT" in str(e), str(e))
    else:
        con.execute("DELETE FROM SalesStockReservation WHERE createdBy='t3'")
        con.commit()
        try:
            con.execute("INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES ((SELECT id FROM OrderLine WHERE id=12), 68, 4.0, 't4')")
            con.commit()
            check("sur-réservation : refusée (garde quantité)", False, "insertion acceptée à tort")
        except sqlite3.IntegrityError as e:
            check("sur-réservation : refusée (garde quantité)", "RESERVATION_EXCEEDS_LOT" in str(e), str(e))

    con.close()
    os.remove(tmp)
    parent = tmp.parent
    if parent.exists() and not any(parent.iterdir()):
        parent.rmdir()
    failures = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failures)}/{len(results)} PASS")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
