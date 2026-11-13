#!/usr/bin/env python3
"""P5.15.13 — SEC-01 : purge des sessions de test sur une COPIE destinée à être diffusée.

Contexte (contre-audit) : 126 sessions de recette (comptes fictifs rc*, administrateur)
étaient conservées dans la base de preuves livrée. Les sessions sont des artefacts
d'authentification ÉPHÉMÈRES (jetons à durée de vie finie) ; elles ne constituent pas
des preuves (les preuves sont les journaux d'audit nominatifs AuditEvent /
GoCmdAccessAudit, les documents et les mouvements, tous CONSERVÉS).

Ce script :
 1. vérifie que TOUTES les sessions appartiennent à des comptes de test documentés
    (liste blanche explicite) — sinon ABORTE sans rien écrire ;
 2. vérifie qu'aucune clé étrangère ne dépend de la table des sessions ;
 3. supprime EXCLUSIVEMENT les lignes de GoCmdSession (jamais les comptes GoCmdUser,
    jamais les journaux d'audit, jamais les événements de preuve) ;
 4. exporte les statistiques avant/après et la empreinte SHA-256 de la base.

Interdictions respectées : dry-run par défaut ; --apply exige --backup externe ;
idempotent ; AUCUNE purge sur une base d'exploitation (les comptes de production
ne figurent pas dans la liste blanche de comptes fictifs → refus).
"""
import argparse, hashlib, json, pathlib, sqlite3, sys, datetime as dt

TEST_ACCOUNTS = {  # comptes fictifs de la recette complémentaire (rc_lib, rc00_comptes.py)
    'rcach', 'rcapp', 'rcrec', 'rcqua', 'rcsto', 'rccom1', 'rccom2', 'rcdir',
    'rcfin1', 'rcfin2', 'rcsto2', 'rcrec2', 'administrateur',
}

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def purge(db, apply=False, backup=None, report=None):
    target = pathlib.Path(db).expanduser().resolve()
    if not target.is_file():
        raise ValueError('Base SQLite absente')
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
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'GoCmdSession' not in tables:
            print('Table GoCmdSession absente : rien à faire.')
            return
        before = dict(con.execute("SELECT username, COUNT(*) FROM GoCmdSession GROUP BY username ORDER BY username").fetchall())
        total_before = sum(before.values())
        foreign = con.execute("PRAGMA foreign_key_list(GoCmdSession)").fetchall()
        unknown = [u for u in before if u not in TEST_ACCOUNTS]
        if unknown:
            raise ValueError(f'Sessions hors comptes de test fictifs détectées : {sorted(unknown)} — '
                             'ABAND : base d\'exploitation ? Ne JAMAIS purger.')
        users = con.execute("SELECT username FROM GoCmdUser").fetchall()
        audits = con.execute("SELECT COUNT(*) FROM AuditEvent").fetchone()[0]
        access = con.execute("SELECT COUNT(*) FROM GoCmdAccessAudit").fetchone()[0] if 'GoCmdAccessAudit' in tables else -1
        print(f"Sessions avant : {total_before} — par compte : {before}")
        print(f"Comptes GoCmdUser conservés : {len(users)} | AuditEvent conservés : {audits} | "
              f"GoCmdAccessAudit conservés : {access if access >= 0 else 'table absente'}")
        print(f"Clés étrangères de GoCmdSession : {len(foreign)} (aucune dépendance inverse attendue)")
        if not apply:
            print('DRY-RUN : aucune écriture. Rejouer avec --apply --backup <chemin externe>.')
            return
        import shutil
        shutil.copy2(target, backup)
        print(f'sauvegarde : {backup}')
        con.execute('DELETE FROM GoCmdSession')
        con.commit()
        after = con.execute("SELECT COUNT(*) FROM GoCmdSession").fetchone()[0]
        assert after == 0
        users2 = con.execute("SELECT username FROM GoCmdUser").fetchall()
        audits2 = con.execute("SELECT COUNT(*) FROM AuditEvent").fetchone()[0]
        access2 = con.execute("SELECT COUNT(*) FROM GoCmdAccessAudit").fetchone()[0] if 'GoCmdAccessAudit' in tables else -1
        assert len(users2) == len(users), 'comptes touchés — abandon'
        assert audits2 == audits, 'journaux d\'audit touchés — abandon'
        assert (access2 == access), 'journal d\'accès touché — abandon'
        assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not con.execute('PRAGMA foreign_key_check').fetchall()
        print(f'Sessions après : {after} | comptes intacts : {len(users2)} | audits intacts : {audits2}')
        if report:
            pathlib.Path(report).write_text(json.dumps({
                'statut': 'APPLIQUÉ', 'horodatage': int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000),
                'base': str(target), 'sha256_apres': sha256_file(target),
                'sessions_avant': total_before, 'sessions_apres': after,
                'repartition_avant': before,
                'invariants': {'comptes': len(users2), 'AuditEvent': audits2, 'GoCmdAccessAudit': access2},
            }, ensure_ascii=False, indent=1), encoding='utf-8')
            print(f'rapport : {report}')
    finally:
        con.close()

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--db', required=True)
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--backup')
    ap.add_argument('--report')
    a = ap.parse_args()
    try:
        purge(a.db, a.apply, a.backup, a.report)
    except Exception as e:
        print('ERROR:', e, file=sys.stderr)
        sys.exit(1)
