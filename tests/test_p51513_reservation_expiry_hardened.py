#!/usr/bin/env python3
"""P5.15.13 — Durcissement de la garde de péremption AN-CPL-01 (LIV-02).

Contexte : les bases livrées contiennent des dates écrites en TEXTE
(ensemencement SQL direct, ex. receivedAt='2026-11-05 12:30:00') ET en
epoch-ms (écritures Prisma, vérifié empiriquement). La comparaison P5.15.12
(l."expiresAt" > epoch-ms) laissait passer à tort un lot PÉRIMÉ dont la date
est en TEXTE : en SQLite, tout TEXT > tout INTEGER. La garde durcie P5.15.13
discrimine typeof() et échoue en fermeture sur valeur non interprétable.

Matrice comportementale (base éphémère) :
  A. epoch-ms future  → réservation acceptée (défaut P5.15.11 reproduit sinon)
  B. epoch-ms périmée → réservation refusée (garde conservée)
  C. sans péremption  → réservation acceptée (nominal historique)
  D. sur-réservation  → refusée (garde quantité conservée)
  E. TEXTE future     → acceptée (nouveau : texte interprété, pas contourné)
  F. TEXTE périmée    → REFUSÉE (durcissement : P5.15.12 l'acceptait à tort)
  G. TEXTE incohérente→ REFUSÉE (fail-closed)
  H. lot quarantaine  → refusée (statut conservé)
  I. chemin UPDATE    : sur-réservation refusée

Intégration base réelle (copie temporaire de db/custom.db, jamais l'originale) :
  J. dry-run du fix → 2 défauts signalés, aucune écriture
  K. --apply avec sauvegarde → SEULES les définitions des 2 triggers changent
     (sommes de contrôle ligne-à-ligne de toutes les tables inchangées)
  L. idempotence → 2e exécution : « aucun défaut »
  M. trigger vivant → INSERT d'une réservation sur lot inexistant → ABORT
     RESERVATION_EXCEEDS_LOT (annulé par ROLLBACK, aucune écriture persistée)
  N. les 2 scripts source portent la signature durcie, pas le défaut P5.15.11

Exécution : python tests/test_p51513_reservation_expiry_hardened.py
"""
import hashlib, importlib.util, json, os, pathlib, shutil, sqlite3, sys, tempfile, time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
UPGRADE = ROOT / "scripts" / "upgrade_sales_reservation_p5154.py"
FIX = ROOT / "scripts" / "fix_reservation_trigger_p51512.py"
REAL_DB = ROOT / "db" / "custom.db"

DEFECT_SIGNATURE = '(l."expiresAt" IS NULL OR datetime(l."expiresAt")>datetime(\'now\'))'
HARDENED_MARK = 'typeof(l."expiresAt") IN (\'integer\',\'real\')'

SCHEMA = """
CREATE TABLE "Product" ("id" INTEGER PRIMARY KEY, "materialId" INTEGER NOT NULL);
CREATE TABLE "OrderLine" ("id" INTEGER PRIMARY KEY, "productId" INTEGER NOT NULL REFERENCES "Product"("id"));
CREATE TABLE "StockLot" ("id" INTEGER PRIMARY KEY, "materialId" INTEGER NOT NULL,
  "qty" REAL NOT NULL, "status" TEXT NOT NULL, "expiresAt");
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
INSERT INTO "OrderLine" VALUES (10, 1), (11, 1), (12, 1), (13, 1), (14, 1), (15, 1), (16, 1), (17, 1);
"""

RESULTS = []
def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f" | {detail}" if detail and not cond else ""))

def load_hardened_ddl():
    text = UPGRADE.read_text(encoding="utf-8")
    check("N1: script upgrade sans signature défaut P5.15.11", DEFECT_SIGNATURE not in text)
    check("N2: script upgrade avec garde durcie typeof", HARDENED_MARK in text)
    ftext = FIX.read_text(encoding="utf-8")
    check("N3: script fix avec garde durcie typeof", HARDENED_MARK in ftext)
    spec = importlib.util.spec_from_file_location("upgrade_p5154_src", UPGRADE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    triggers = [s for s in mod.DDL if "gocmd_p5154_reservation_insert" in s or "gocmd_p5154_reservation_update" in s]
    check("N4: 2 triggers de réservation dans le DDL", len(triggers) == 2, f"trouvé {len(triggers)}")
    for t in triggers:
        check(f"N5: typeof présent dans {t.split(chr(34))[1]}", "typeof(l.\"expiresAt\")" in t)
    return [t.replace("CREATE TRIGGER IF NOT EXISTS", "CREATE TRIGGER", 1) for t in triggers]

def expect_refused(con, name, sql, params, detail=""):
    try:
        con.execute(sql, params); con.commit()
        check(name, False, "accepté à tort")
    except sqlite3.IntegrityError as e:
        check(name, "RESERVATION_EXCEEDS_LOT" in str(e), str(e))

def expect_accepted(con, name, sql, params):
    try:
        con.execute(sql, params); con.commit()
        check(name, True)
    except sqlite3.IntegrityError as e:
        check(name, False, str(e))

def table_digests(con):
    """Somme de contrôle ligne-à-ligne de toutes les tables (contenu ordonné)."""
    digests = {}
    for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        rows = con.execute(f'SELECT * FROM "{name}" ORDER BY rowid').fetchall()
        h = hashlib.sha256(repr(rows).encode()).hexdigest()
        digests[name] = (len(rows), h)
    return digests

def main():
    ddl = load_hardened_ddl()
    now_ms = int(time.time() * 1000)
    future_ms = now_ms + 90 * 24 * 3600 * 1000
    past_ms = now_ms - 24 * 3600 * 1000

    # ---------- Partie 1 : matrice comportementale sur base éphémère ----------
    tmpdir = pathlib.Path(tempfile.mkdtemp(prefix="gocmd_p51513_"))
    scratch = tmpdir / "scratch.db"
    con = sqlite3.connect(str(scratch))
    con.executescript(SCHEMA)
    for stmt in ddl:
        con.execute(stmt)
    con.commit()
    con.executemany('INSERT INTO "StockLot" VALUES (?,?,?,?,?)', [
        (64, 7, 2.0, "available", future_ms),          # A: epoch future
        (66, 7, 5.0, "available", past_ms),            # B: epoch périmé
        (68, 7, 10.0, "available", None),               # C: sans péremption
        (70, 7, 4.0, "available", "2027-06-01 00:00:00"),  # E: TEXTE future
        (71, 7, 6.0, "available", "2020-01-01 00:00:00"),  # F: TEXTE périmée
        (72, 7, 7.0, "available", "bogus-date"),       # G: TEXTE incohérente
        (73, 7, 8.0, "quarantine", future_ms),         # H: quarantaine
    ])
    con.commit()

    expect_accepted(con, "A: epoch-ms future → réservation acceptée",
        'INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (10, 64, 2.0, ?)', ("t-A",))
    expect_refused(con, "B: epoch-ms périmée → réservation refusée",
        'INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (11, 66, 1.0, ?)', ("t-B",))
    expect_accepted(con, "C: sans péremption → réservation acceptée",
        'INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (12, 68, 7.0, ?)', ("t-C",))
    expect_refused(con, "D: sur-réservation (7/10 déjà) → refusée",
        'INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (13, 68, 4.0, ?)', ("t-D",))
    expect_accepted(con, "E: TEXTE future → réservation acceptée",
        'INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (14, 70, 3.0, ?)', ("t-E",))
    expect_refused(con, "F: TEXTE périmée → réservation REFUSÉE (durcissement P5.15.13)",
        'INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (15, 71, 2.0, ?)', ("t-F",))
    expect_refused(con, "G: TEXTE incohérente → réservation refusée (fail-closed)",
        'INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (16, 72, 2.0, ?)', ("t-G",))
    expect_refused(con, "H: lot quarantaine → réservation refusée",
        'INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (17, 73, 2.0, ?)', ("t-H",))
    try:
        con.execute('UPDATE SalesStockReservation SET qty = 11.0 WHERE createdBy = ?', ("t-C",)); con.commit()
        check("I: sur-réservation par UPDATE → refusée", False, "update accepté à tort")
    except sqlite3.IntegrityError as e:
        check("I: sur-réservation par UPDATE → refusée", "RESERVATION_EXCEEDS_LOT" in str(e), str(e))
    # contre-preuve F : sur la version P5.15.12, le lot F (TEXTE périmée) était accepté à tort
    con.close()

    # ---------- Partie 2 : contre-preuve du défaut P5.15.12 (TEXTE périmée acceptée) ----------
    scratch2 = tmpdir / "p51512_version.db"
    con2 = sqlite3.connect(str(scratch2))
    con2.executescript(SCHEMA)
    p51512_ddl = [t.replace("CREATE TRIGGER IF NOT EXISTS", "CREATE TRIGGER", 1) for t in [
        '''CREATE TRIGGER IF NOT EXISTS "gocmd_p5154_reservation_insert"
 AFTER INSERT ON "SalesStockReservation"
 BEGIN
   SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "StockLot" l
    JOIN "OrderLine" ol ON ol.id=NEW."orderLineId"
    JOIN "Product" p ON p.id=ol."productId"
    WHERE l.id=NEW."stockLotId" AND l."materialId"=p."materialId"
      AND l."status"='available' AND
      (l."expiresAt" IS NULL OR l."expiresAt" > CAST(strftime('%s','now') AS INTEGER)*1000)
      AND l."qty"+0.0000001 >=
       (SELECT COALESCE(SUM(r."qty"),0) FROM "SalesStockReservation" r WHERE r."stockLotId"=l.id)
   ) THEN RAISE(ABORT,'RESERVATION_EXCEEDS_LOT') END;
 END''']]
    for stmt in p51512_ddl:
        con2.execute(stmt)
    con2.execute('INSERT INTO "StockLot" VALUES (71, 7, 6.0, "available", ?)', ("2020-01-01 00:00:00",))
    con2.commit()
    try:
        con2.execute('INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy) VALUES (15, 71, 2.0, ?)', ("t-F12",))
        con2.commit()
        refused = False
    except sqlite3.IntegrityError:
        refused = True
    check("F-contre-preuve: la version P5.15.12 acceptait à tort le lot TEXTE périmé (défaut reproduit)",
          not refused, "la version P5.15.12 refusait déjà (durcissement non nécessaire ?)")
    con2.close()

    # ---------- Partie 3 : intégration sur copie de la base démo réelle ----------
    if REAL_DB.is_file():
        workdir = tmpdir / "integration"
        workdir.mkdir()
        target = workdir / "custom.db"
        shutil.copy2(REAL_DB, target)
        before_master = table_digests(sqlite3.connect(str(target)))
        con3 = sqlite3.connect(str(target))
        trig_before = con3.execute("SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").fetchall()
        digests_before = table_digests(con3)
        con3.close()

        # Rend le scénario DÉTERMINISTE : la base livrée P5.15.13 est déjà durcie
        # (« Aucun défaut » est l'état attendu à l'état neuf). Pour prouver le FLUX de
        # correction (dry-run → apply → idempotence) quel que soit l'état de la base,
        # la copie temporaire est remise à l'ancienne forme P5.15.11 AVANT la partie J/K/L.
        import sqlite3 as _sq
        MARK = 'typeof(l."expiresAt")'
        OLD_INSERT = '''CREATE TRIGGER "gocmd_p5154_reservation_insert"
 AFTER INSERT ON "SalesStockReservation"
 BEGIN
   SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "StockLot" l
    JOIN "OrderLine" ol ON ol.id=NEW."orderLineId"
    JOIN "Product" p ON p.id=ol."productId"
    WHERE l.id=NEW."stockLotId" AND l."materialId"=p."materialId"
      AND l."status"='available' AND
      (l."expiresAt" IS NULL OR datetime(l."expiresAt")>datetime('now'))
      AND l."qty"+0.0000001 >=
       (SELECT COALESCE(SUM(r."qty"),0) FROM "SalesStockReservation" r WHERE r."stockLotId"=l.id)
   ) THEN RAISE(ABORT,'RESERVATION_EXCEEDS_LOT') END;
 END'''
        OLD_UPDATE = OLD_INSERT.replace(
            'AFTER INSERT ON "SalesStockReservation"',
            'AFTER UPDATE OF "qty","stockLotId","orderLineId" ON "SalesStockReservation"'
        ).replace('_insert', '_update')
        con_de = _sq.connect(str(target))
        already_hardened = con_de.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' "
            "AND name LIKE 'gocmd_p5154_reservation%' AND sql LIKE ?", ("%" + MARK + "%",)).fetchone()[0]
        if already_hardened == 2:
            con_de.execute('DROP TRIGGER IF EXISTS "gocmd_p5154_reservation_insert"')
            con_de.execute('DROP TRIGGER IF EXISTS "gocmd_p5154_reservation_update"')
            con_de.execute(OLD_INSERT)
            con_de.execute(OLD_UPDATE)
            con_de.commit()
            print("NOTE: copie temporaire remise à l'ancienne forme P5.15.11 pour prouver le flux de correction.")
        con_de.close()
        import subprocess
        dry = subprocess.run([sys.executable, str(FIX), "--db", str(target)], capture_output=True, text=True)
        out = dry.stdout + dry.stderr
        check("J1: dry-run signale les 2 défauts sans écriture", "NON CONFORME" in out and "DRY-RUN" in out, out[-300:])
        con4 = sqlite3.connect(str(target)); digests_after_dry = table_digests(con4); con4.close()
        check("J2: dry-run n'a rien modifié", digests_before == digests_after_dry)

        backup_path = tmpdir / "backup-externe.db"  # hors du dossier de la base (contrainte du script)
        app = subprocess.run([sys.executable, str(FIX), "--db", str(target), "--apply", "--backup", str(backup_path)],
                             capture_output=True, text=True)
        out = app.stdout + app.stderr
        check("K1: apply réussi avec sauvegarde externe", "Correctif P5.15.13 appliqué" in out, out[-300:])
        check("K2: sauvegarde créée", backup_path.is_file())
        con5 = sqlite3.connect(str(target))
        digests_after = table_digests(con5)
        changed = {t for t in digests_before if digests_before[t] != digests_after.get(t)}
        check("K3: aucune ligne de donnée modifiée (sommes de contrôle tables identiques)", not changed,
              f"tables modifiées: {sorted(changed)}")
        trig_after = con5.execute("SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").fetchall()
        check("K4: même nombre de triggers", len(trig_before) == len(trig_after))
        for (n1, s1), (n2, s2) in zip(sorted(trig_before), sorted(trig_after)):
            if n2.startswith("gocmd_p5154_reservation"):
                check(f"K5: {n2} régénéré durci", HARDENED_MARK in s2 and "datetime" in s2)
            else:
                check(f"K5: {n2} inchangé", s1 == s2)
        con5.close()

        dry2 = subprocess.run([sys.executable, str(FIX), "--db", str(target)], capture_output=True, text=True)
        out2 = dry2.stdout + dry2.stderr
        check("L: idempotence — 2e exécution « Aucun défaut »", "Aucun défaut" in out2, out2[-300:])

        # M: trigger vivant sur la base réelle (transaction annulée)
        con6 = sqlite3.connect(str(target))
        con6.execute("PRAGMA foreign_keys=ON")
        try:
            con6.execute('BEGIN')
            lot = con6.execute("SELECT l.id FROM StockLot l WHERE l.status='available' AND l.qty>0 LIMIT 1").fetchone()
            ol = con6.execute("SELECT ol.id FROM OrderLine ol JOIN Product p ON p.id=ol.productId LIMIT 1").fetchone()
            if ol is None:
                # P5.15.20 : la base démo livrée est sans transaction (référence
                # P5.15.17 : zéro commande). Pour prouver que le trigger durci
                # reste VIVANT, créer une ligne de commande ÉPHÉMÈRE dans la
                # transaction courante (jamais commise, annulée avec l'insertion
                # interdite) : produit existant lié à la matière du lot retenu.
                pair = con6.execute(
                    "SELECT p.id FROM Product p JOIN StockLot l ON l.materialId=p.materialId "
                    "WHERE l.status='available' AND l.qty>0 LIMIT 1").fetchone()
                client = con6.execute("SELECT id FROM Client LIMIT 1").fetchone()
                con6.execute('INSERT INTO "Order" (ref, clientId) VALUES (?,?)',
                             ('TEST-P51513-TRIGGER', client[0]))
                order_id = con6.execute("SELECT last_insert_rowid()").fetchone()[0]
                con6.execute('INSERT INTO OrderLine (orderId, productId, qty, unitPrice) VALUES (?,?,1.0,1.0)',
                             (order_id, pair[0]))
                ol = con6.execute("SELECT last_insert_rowid()").fetchone()
            con6.execute('INSERT INTO SalesStockReservation (orderLineId, stockLotId, qty, createdBy, createdAt, updatedAt) '
                         'VALUES (?,?,999999999.0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
                         (ol[0], lot[0], "test-p51513"))
            con6.rollback()  # le test ne doit jamais persister une insertion interdite (ni la ligne éphémère)
            check("M: trigger vivant — sur-réservation massivement refusée", False, "acceptée à tort")
        except sqlite3.IntegrityError as e:
            con6.rollback()
            check("M: trigger vivant — sur-réservation massivement refusée", "RESERVATION_EXCEEDS_LOT" in str(e), str(e))
        con6.close()
        con7 = sqlite3.connect(str(target))
        try:
            digests_after_rollback = table_digests(con7)
        finally:
            con7.close()
        check("M2: base réelle intacte après test annulé",
              digests_after_rollback == digests_after,
              f"tables modifiées: {sorted(t for t in digests_after if digests_after[t] != digests_after_rollback.get(t))}")
    else:
        print("NOTE: db/custom.db absente — partie intégration sautée (NON EXÉCUTÉ).")

    shutil.rmtree(tmpdir, ignore_errors=True)
    failures = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failures)}/{len(RESULTS)} PASS")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
