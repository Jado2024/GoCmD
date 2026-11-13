#!/usr/bin/env python3
"""Migration additive P6 (2026-11-11) — modèle explicite d'ancienneté des réservations.

Chantier 2, §3.3 de la mission P6 : distinguer sans ambiguïté
  - date de création            (createdAt, existant) ;
  - date de début d'engagement  (engagedAt, NOUVEAU — fixé à la création, jamais
    rajeuni par une modification administrative ou une livraison partielle) ;
  - dernière modification       (updatedAt, existant pour les réservations
    matière ; NOUVEAU pour les réservations de stock fini) ;
  - date de livraison prévue    (Order.dueDate, existant, inchangé) ;
  - date d'alerte               (calculée : engagedAt + warningHours) ;
  - date de libération          (AuditEvent SALES_STOCK_RELEASED horodaté — la
    ligne de réservation est supprimée à la libération, l'événement d'audit en
    conserve la trace ; aucun changement de modèle nécessaire).

Motif : l'expiration et l'alerte étaient calculées sur SalesStockReservation.updatedAt,
qui est rafraîchi par TOUTE écriture (notamment la consommation partielle d'une
réservation lors d'une livraison). Une réservation ancienne pouvait ainsi
apparaître « jeune » après une simple modification. Le calcul utilise désormais
engagedAt, strictement croissant en sémantique d'engagement.

Compatibilité : migration STRICTEMENT ADDITIVE.
  - Aucune colonne supprimée ou renommée ; aucun trigger modifié.
  - SalesStockReservation.engagedAt est initialisé à createdAt pour les lignes
    historiques (sémantique exacte : l'engagement a débuté à la création).
  - FinishedStockReservation.updatedAt reste NULL pour les lignes existantes
    jusqu'à leur prochaine modification (Prisma @updatedAt le maintiendra ensuite).
  - Idempotente : réexécuter ne change rien.
Sauvegarde de la base par l'API de sauvegarde SQLite avant toute écriture.
"""
import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from contextlib import closing

MATERIAU_COL = "engagedAt"
FINI_COL = "updatedAt"
# Bases anciennes : engagedAt nullable après ALTER ; le schéma Prisma le
# décrit NOT NULL. Garantir la date d'engagement sans reconstruire la table.
INSERT_GUARD = "gocmd_p6_engagement_default_insert"
UPDATE_GUARD = "gocmd_p6_engagement_immutable_update"


def _columns(con, table):
    return {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}


def migrate(db: str, apply: bool = False) -> bool:
    path = Path(db).resolve()
    if not path.is_file():
        raise ValueError('Base absente')
    with sqlite3.connect(path) as con:
        con.execute('PRAGMA foreign_keys=ON')
        if con.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Intégrité de la base invalide')
        if con.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Clés étrangères incohérentes : migration refusée')
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for required in ('SalesStockReservation', 'FinishedStockReservation'):
            if required not in tables:
                raise ValueError(f'Table {required} absente : migration préalable manquante')
        mat_cols = _columns(con, 'SalesStockReservation')
        fin_cols = _columns(con, 'FinishedStockReservation')
        need_mat = MATERIAU_COL not in mat_cols
        need_fin = FINI_COL not in fin_cols
        # Independent database parity: an earlier P6 migration added the column
        # but forgot its Prisma-declared index. A rerun must repair that drift.
        index_name = "SalesStockReservation_engagedAt_idx"
        need_index = con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
            (index_name,)
        ).fetchone() is None
        nullable_mat = not need_mat and next(
            row for row in con.execute('PRAGMA table_info("SalesStockReservation")')
            if row[1] == MATERIAU_COL
        )[3] == 0
        guards = {row[0] for row in con.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='SalesStockReservation'"
        )}
        need_guards = nullable_mat and (INSERT_GUARD not in guards or UPDATE_GUARD not in guards)
        need_backfill = not need_mat and con.execute(
            'SELECT 1 FROM "SalesStockReservation" WHERE "engagedAt" IS NULL LIMIT 1'
        ).fetchone() is not None
        needed = need_mat or need_fin or need_index or need_guards or need_backfill
        print('Ancienneté des réservations :', 'requise' if needed else 'installée',
              '(application)' if apply else '(contrôle seul)')
        if not apply or not needed:
            return needed
        backup = path.with_name(path.stem + '.avant_anciennete_p6_'
                                + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.db')
        # BEGIN IMMEDIATE empêche toute écriture tierce pendant le snapshot et
        # la migration. En production : arrêter le service en maintenance et
        # garder la sauvegarde complète externe (base + documents privés).
        # Jamais de copie brute d'un fichier SQLite actif.
        con.execute('PRAGMA busy_timeout=8000')
        con.execute('BEGIN IMMEDIATE')
        try:
            # Une deuxième connexion source effectue la sauvegarde cohérente
            # pendant que le verrou IMMEDIATE détenu par con fige les écritures.
            with closing(sqlite3.connect(f'file:{path.as_posix()}?mode=ro', uri=True, timeout=8)) as reader:
                with closing(sqlite3.connect(backup)) as destination:
                    reader.backup(destination)
            with closing(sqlite3.connect(backup)) as check_backup:
                if check_backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('Sauvegarde de précaution non intègre : migration refusée')
                if check_backup.execute('PRAGMA foreign_key_check').fetchone():
                    raise ValueError('Sauvegarde de précaution avec FK invalides : migration refusée')
            print('Sauvegarde SQLite contrôlée :', backup.name)
        except Exception:
            con.rollback()
            backup.unlink(missing_ok=True)
            raise
        # Ajout des colonnes puis backfill dans le verrou conservé.
        try:
            if need_mat:
                con.execute(f'ALTER TABLE "SalesStockReservation" ADD COLUMN "{MATERIAU_COL}" DATETIME')
                # Backfill : l'engagement historique a débuté à la création.
                con.execute(f'UPDATE "SalesStockReservation" SET "{MATERIAU_COL}"="createdAt" WHERE "{MATERIAU_COL}" IS NULL')
            if need_fin:
                con.execute(f'ALTER TABLE "FinishedStockReservation" ADD COLUMN "{FINI_COL}" DATETIME')
            # Réparer les anciennes lignes NULL, indépendamment de la colonne.
            con.execute('UPDATE "SalesStockReservation" SET "engagedAt"="createdAt" WHERE "engagedAt" IS NULL')
            # CREATE INDEX is required even when the columns already existed.
            con.execute('CREATE INDEX IF NOT EXISTS "SalesStockReservation_engagedAt_idx" '
                        'ON "SalesStockReservation"("engagedAt")')
            if nullable_mat or need_mat:
                # Une colonne SQLite nullable ne peut être durcie en place.
                # AFTER INSERT garantit la sémantique de NOT NULL/DEFAULT.
                con.execute(f'''CREATE TRIGGER IF NOT EXISTS "{INSERT_GUARD}"
                    AFTER INSERT ON "SalesStockReservation"
                    WHEN NEW."engagedAt" IS NULL
                    BEGIN
                      UPDATE "SalesStockReservation" SET "engagedAt"=COALESCE(NEW."createdAt",CURRENT_TIMESTAMP)
                      WHERE "id"=NEW."id";
                    END''')
                # Une fois fixée, la date d'engagement ne peut être rajeunie.
                con.execute(f'''CREATE TRIGGER IF NOT EXISTS "{UPDATE_GUARD}"
                    BEFORE UPDATE OF "engagedAt" ON "SalesStockReservation"
                    WHEN OLD."engagedAt" IS NOT NULL AND NEW."engagedAt" IS NOT OLD."engagedAt"
                    BEGIN SELECT RAISE(ABORT,'GOCMD_ENGAGEMENT_DATE_IMMUTABLE'); END''')
            con.commit()
        except Exception:
            con.rollback()
            raise
        # Vérifications après migration.
        if con.execute(f'SELECT COUNT(*) FROM "SalesStockReservation" WHERE "{MATERIAU_COL}" IS NULL').fetchone()[0]:
            raise ValueError('Backfill engagedAt incomplet')
        if con.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Intégrité invalide après migration')
        if con.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Clés étrangères incohérentes après migration')
        print('Migration P6 ancienneté appliquée : colonnes, index et gardes des bases historiques alignés.')
        return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True, help='Chemin de la base SQLite à migrer')
    parser.add_argument('--apply', action='store_true', help='Appliquer réellement (sinon contrôle seul)')
    args = parser.parse_args()
    try:
        required = migrate(args.db, args.apply)
    except (ValueError, sqlite3.Error) as exc:
        print(f'MIGRATION P6 REFUSÉE : {exc}', file=sys.stderr)
        sys.exit(2)
    sys.exit(0 if (args.apply or not required) else 1)
