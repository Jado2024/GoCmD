#!/usr/bin/env python3
"""Correctif AN-CPL-01 (P5.15.12) puis durcissement (P5.15.13) : triggers de
réservation gocmd_p5154_reservation_insert/update.

Défaut initial (P5.15.11) : la garde SQL comparait datetime(l."expiresAt") > datetime('now').
Or Prisma 6.19.3 stocke les DateTime SQLite en MILLISECONDES EPOCH (vérifié
empiriquement : typeof(expiresAt)='integer' après écriture Prisma). SQLite
interprète un entier passé à datetime() comme un jour julien → retourne NULL →
la condition de péremption devient fausse → RAISE(ABORT,'RESERVATION_EXCEEDS_LOT')
systématique pour TOUT lot avec date de péremption. L'API renvoyait alors une
erreur trompeuse « Conflit de données : vérifier les documents et réessayer »
(Prisma mappe l'ABORT du trigger en P2003 « clé étrangère », faux diagnostic).

Correctif P5.15.12 (epoch cohérent) :
  AVANT : (l."expiresAt" IS NULL OR datetime(l."expiresAt")>datetime('now'))
  P5.15.12 : (l."expiresAt" IS NULL OR l."expiresAt" > CAST(strftime('%s','now') AS INTEGER)*1000)

Durcissement P5.15.13 (contre-audit LIV-02) : les bases livrées contiennent des
dates écrites en TEXTE (ensemencement SQL direct, ex. receivedAt='2026-11-05 12:30:00')
ET en epoch-ms (écritures Prisma). En SQLite, tout TEXT est supérieur à tout
INTEGER : la comparaison P5.15.12 laissait passer à tort un lot périmé dont la
date serait stockée en TEXTE (garde contournée). La garde durcie discrimine le
type de stockage réel et échoue en fermeture (fail-closed) sur une valeur non
interprétable :

  P5.15.13 : (l."expiresAt" IS NULL
              OR (typeof(l."expiresAt") IN ('integer','real')
                  AND l."expiresAt" > CAST(strftime('%s','now') AS INTEGER)*1000)
              OR (typeof(l."expiresAt")='text'
                  AND datetime(l."expiresAt") IS NOT NULL
                  AND datetime(l."expiresAt") > datetime('now')))

Aucune donnée modifiée : seules les définitions des 2 triggers sont recréées.
Script idempotent : dry-run par défaut ; --apply exige --backup externe
(conforme au standard des migrations GoCmd, cf. upgrade_sales_reservation_p5154.py).
Le script recrée les triggers si et seulement s'ils ne sont pas déjà conformes à
la signature durcie P5.15.13 (détecte donc aussi bien l'ancien datetime() que la
version intermédiaire P5.15.12 sans discrimination de type).
"""
import argparse, pathlib, sqlite3, sys

HARDENED_MARK = 'typeof(l."expiresAt") IN (\'integer\',\'real\')'

TRIGGERS_FIXED = {
 "gocmd_p5154_reservation_insert": '''CREATE TRIGGER "gocmd_p5154_reservation_insert"
 AFTER INSERT ON "SalesStockReservation"
 BEGIN
   SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "StockLot" l
    JOIN "OrderLine" ol ON ol.id=NEW."orderLineId"
    JOIN "Product" p ON p.id=ol."productId"
    WHERE l.id=NEW."stockLotId" AND l."materialId"=p."materialId"
      AND l."status"='available' AND
      (l."expiresAt" IS NULL
       OR (typeof(l."expiresAt") IN ('integer','real')
           AND l."expiresAt" > CAST(strftime('%s','now') AS INTEGER)*1000)
       OR (typeof(l."expiresAt")='text'
           AND datetime(l."expiresAt") IS NOT NULL
           AND datetime(l."expiresAt") > datetime('now')))
      AND l."qty"+0.0000001 >=
       (SELECT COALESCE(SUM(r."qty"),0) FROM "SalesStockReservation" r WHERE r."stockLotId"=l.id)
   ) THEN RAISE(ABORT,'RESERVATION_EXCEEDS_LOT') END;
 END''',
 "gocmd_p5154_reservation_update": '''CREATE TRIGGER "gocmd_p5154_reservation_update"
 AFTER UPDATE OF "qty","stockLotId","orderLineId" ON "SalesStockReservation"
 BEGIN
   SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "StockLot" l
    JOIN "OrderLine" ol ON ol.id=NEW."orderLineId"
    JOIN "Product" p ON p.id=ol."productId"
    WHERE l.id=NEW."stockLotId" AND l."materialId"=p."materialId"
      AND l."status"='available' AND
      (l."expiresAt" IS NULL
       OR (typeof(l."expiresAt") IN ('integer','real')
           AND l."expiresAt" > CAST(strftime('%s','now') AS INTEGER)*1000)
       OR (typeof(l."expiresAt")='text'
           AND datetime(l."expiresAt") IS NOT NULL
           AND datetime(l."expiresAt") > datetime('now')))
      AND l."qty"+0.0000001 >=
       (SELECT COALESCE(SUM(r."qty"),0) FROM "SalesStockReservation" r WHERE r."stockLotId"=l.id)
   ) THEN RAISE(ABORT,'RESERVATION_EXCEEDS_LOT') END;
 END''',
}

def hardened(con, name):
    row = con.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?", (name,)).fetchone()
    if not row: return False
    return HARDENED_MARK in (row[0] or "")

def current_defect(con, name):
    """Défaut = trigger présent mais non conforme à la signature durcie P5.15.13
    (couvre l'ancien datetime() de P5.15.11 ET la version epoch P5.15.12)."""
    row = con.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?", (name,)).fetchone()
    if not row: return None
    return not hardened(con, name)

def migrate(db, apply=False, backup=None):
    target = pathlib.Path(db).expanduser().resolve()
    if not target.is_file():
        raise ValueError('Base SQLite absente : aucun fichier créé')
    if apply and not backup:
        raise ValueError('--backup externe obligatoire avec --apply')
    if apply:
        backup = pathlib.Path(backup).expanduser().resolve()
        if backup.exists() or backup == target or backup.parent == target.parent:
            raise ValueError('Le fichier de sauvegarde doit être nouveau et hors du dossier de base')
    con = sqlite3.connect(str(target) if apply else target.as_uri() + '?mode=ro', uri=not apply)
    try:
        con.execute('PRAGMA foreign_keys=ON')
        assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'Base non intègre'
        defects = []
        for name in TRIGGERS_FIXED:
            exists = con.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?", (name,)).fetchone()[0]
            if not exists:
                defects.append((name, 'ABSENT'))
            elif current_defect(con, name):
                defects.append((name, 'NON CONFORME P5.15.13 (ancien datetime() ou P5.15.12 sans discrimination de type)'))
        if not defects:
            print('Aucun défaut : triggers déjà conformes P5.15.13 (signature durcie).')
            return
        for name, status in defects:
            print(f'trigger {name} : {status}')
        if not apply:
            print('DRY-RUN : corrections listées ci-dessus, aucune écriture. Rejouer avec --apply --backup <chemin externe>.')
            return
        import shutil
        shutil.copy2(target, backup)
        print(f'sauvegarde : {backup}')
        for name, ddl in TRIGGERS_FIXED.items():
            con.execute(f'DROP TRIGGER IF EXISTS "{name}"')
            con.execute(ddl)
        con.commit()
        # vérifications post-correction
        assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not con.execute('PRAGMA foreign_key_check').fetchall()
        for name in TRIGGERS_FIXED:
            assert not current_defect(con, name), f'{name} encore défectueux'
        print('Correctif P5.15.13 appliqué : 2 triggers recréés (garde péremption durcie epoch-ms + texte), aucune donnée modifiée.')
    finally:
        con.close()

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--backup')
    a = ap.parse_args()
    migrate(a.db, a.apply, a.backup)
