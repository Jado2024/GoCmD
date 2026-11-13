#!/usr/bin/env python3
"""Migration additive, idempotente : aucune ligne produit historique n'est modifiée.
Usage: python scripts/apply_catalogue_upgrade_v1893.py --db ./db/custom.db --apply
Avant modification d'une vraie base : sauvegarde indépendante et recette sur copie.

Audit 10/11/2026 (DB-MIG-01, gravité P1) :
  1. La migration s'exécutait en AUTOCOMMIT (aucune transaction) : une
     interruption laissait une base à moitié migrée (colonnes présentes,
     triggers absents), récupérable seulement par relance manuelle.
  2. La sauvegarde portait un nom FIXE et était SAUTÉE si le fichier
     existait déjà : une relance ultérieure partait d'une copie périmée.
Corrections : BEGIN IMMEDIATE / COMMIT / ROLLBACK englobant toute la
migration, sauvegarde fraîche horodatée à CHAQUE exécution, contrôles
d'intégrité avant et après commit, foreign_keys actifs pendant l'écriture.
"""
import argparse, sqlite3, hashlib
from datetime import datetime
from pathlib import Path

COLS={
 'commercialAbbreviation':'TEXT',
 'commercialBrand':'TEXT',
 'actualManufacturer':'TEXT',
 'descriptionOverride':'TEXT',
}

def apply(db_file:Path):
    if not db_file.is_file(): raise RuntimeError(f"Base absente: {db_file}")
    # Sauvegarde transactionnelle FRAÎCHE à chaque exécution (horodatée) :
    # fiable même si la base utilise WAL ; jamais réutilisée d'une fois sur l'autre.
    stamp=datetime.now().strftime('%Y%m%d-%H%M%S')
    backup=db_file.with_name(f'{db_file.name}.pre-v1893-{stamp}.sqlite')
    with sqlite3.connect(f'file:{db_file.resolve()}?mode=ro',uri=True,timeout=30) as src:
        with sqlite3.connect(backup) as dst: src.backup(dst)
    with sqlite3.connect(backup) as control:
        if control.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
            backup.unlink(missing_ok=True)
            raise RuntimeError('Copie de secours incohérente')
    print(f'Backup transactionnel frais : {backup} sha256={hashlib.sha256(backup.read_bytes()).hexdigest()}')
    # Autocommit explicite : la transaction est pilotée manuellement ci-dessous.
    db=sqlite3.connect(db_file,isolation_level=None,timeout=30)
    try:
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise RuntimeError('Base corrompue')
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE')
        material_cols={x[1] for x in db.execute('PRAGMA table_info(Material)')}
        if 'foamFormat' not in material_cols: db.execute('ALTER TABLE Material ADD COLUMN foamFormat TEXT')
        # Contrôle SQL complémentaire : agglomérée jamais en rouleau.
        for operation in ('INSERT','UPDATE'):
            name=f'go_v1893_foam_format_{operation.lower()}'
            db.execute(f'DROP TRIGGER IF EXISTS {name}')
            db.execute(f'''CREATE TRIGGER {name} BEFORE {operation} ON Material BEGIN
                SELECT CASE WHEN NEW.foamFormat NOT IN ('BLOC','PLAQUE','ROULEAU')
                    THEN RAISE(ABORT,'Format mousse inconnu') END;
                SELECT CASE WHEN NEW.foamNature='AGGLO' AND NEW.foamFormat='ROULEAU'
                    THEN RAISE(ABORT,'Mousse agglomeree jamais en rouleau') END;
                SELECT CASE WHEN NEW.category!='Mousse' AND NEW.foamFormat IS NOT NULL
                    THEN RAISE(ABORT,'Format mousse interdit hors categorie Mousse') END;
            END''')
        cols={x[1] for x in db.execute('PRAGMA table_info(Product)')}
        if not {'id','sku','family'}.issubset(cols): raise RuntimeError('Schéma Product incompatible')
        count=db.execute('SELECT COUNT(*) FROM Product').fetchone()[0]
        changes=[(name,typ) for name,typ in COLS.items() if name not in cols]
        for name,typ in changes: db.execute(f'ALTER TABLE Product ADD COLUMN "{name}" {typ}')
        if db.execute('SELECT COUNT(*) FROM Product').fetchone()[0]!=count:raise RuntimeError('Compte produits modifié')
        # Idempotence SQL : le trigger d'origine interdisait toutes les familles hors 5 références.
        from catalogue_v16 import create_validation_triggers
        create_validation_triggers(db)
        if db.execute('PRAGMA foreign_key_check').fetchone() is not None:raise RuntimeError('Clés étrangères invalides')
        db.execute('COMMIT')
    except BaseException:
        db.execute('ROLLBACK')
        raise
    finally:
        db.close()
    # Contrôles POST-commit : la base migrée doit être intègre et FK-valide.
    with sqlite3.connect(f'file:{db_file.resolve()}?mode=ro',uri=True) as check:
        if check.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise RuntimeError('Base corrompue après migration')
        if check.execute('PRAGMA foreign_key_check').fetchone() is not None: raise RuntimeError('Clés étrangères invalides après migration')
    print(f'PASS — {db_file} : {len(changes)} champs ajoutés, {count} produits préservés, transaction atomique')

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--db',type=Path,required=True);ap.add_argument('--apply',action='store_true')
    args=ap.parse_args()
    if not args.apply: ap.error('Ajoutez --apply sur une copie sauvegardée de la base')
    apply(args.db)
