#!/usr/bin/env python3
"""GoCmd P5.15.28: consistent SQLite snapshot + referenced private supplier PDFs.

This artifact contains business secrets and is NOT encrypted. Store it ONLY on an
access-controlled, encrypted destination outside the application server.
The database snapshot fixes the list of required immutable UUID-named PDFs.
Every referenced file is checked for size/hash; missing/altered => backup FAIL.
No production database, private PDF or business record is modified.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NAME_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f-]{27,}\.pdf$')
HASH_RE = re.compile(r'^[0-9a-f]{64}$')


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as fp:
        for block in iter(lambda: fp.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def referenced_pdfs(db_path: Path) -> list[dict]:
    with sqlite3.connect(f'file:{db_path.as_posix()}?mode=ro', uri=True) as db:
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='SupplierOfferAttachment' AND type='table'").fetchone() is None:
            raise RuntimeError('Table SupplierOfferAttachment absente — pas de sauvegarde métier complète')
        rows = db.execute('SELECT storedName, sha256, bytes FROM SupplierOfferAttachment ORDER BY storedName').fetchall()
    pdfs = []
    for name, sha, size in rows:
        if not isinstance(name, str) or not NAME_RE.fullmatch(name) or not isinstance(sha, str) or not HASH_RE.fullmatch(sha):
            raise RuntimeError('Référence documentaire invalide dans la base')
        if not isinstance(size, int) or not 8 <= size <= 8 * 1024 * 1024:
            raise RuntimeError('Taille de justificatif invalide dans la base')
        pdfs.append({'file': name, 'sha256': sha, 'bytes': size})
    return pdfs


def backup(source: Path, docs: Path, out_dir: Path, retention: int = 14) -> Path:
    if retention < 1:
        raise ValueError('Rétention >= 1 obligatoire')
    source = source.expanduser().resolve()
    docs = docs.expanduser().resolve()
    out_dir = out_dir.expanduser().resolve()
    if not source.is_file():
        raise ValueError('Base source absente')
    if not docs.is_dir():
        raise ValueError('Répertoire des documents privés absent : '+str(docs))
    if out_dir == source.parent or out_dir == docs or out_dir.is_relative_to(docs) or out_dir.is_relative_to(source.parent):
        raise ValueError('Destination doit être distincte des répertoires source (base et documents)')
    out_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name != 'nt':
        os.chmod(out_dir, 0o700)
    final = out_dir / f'gocmd_full_{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.zip'
    with tempfile.TemporaryDirectory(prefix='.gocmd-snapshot-', dir=out_dir) as td:
        snapshot = Path(td) / 'gocmd.db'
        with sqlite3.connect(f'file:{source.as_posix()}?mode=ro', uri=True, timeout=30) as src:
            with sqlite3.connect(snapshot) as dest:
                src.backup(dest, pages=200, sleep=0.1)
        with sqlite3.connect(snapshot) as snap:
            if snap.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Snapshot SQLite integrity_check incorrect')
            if snap.execute('PRAGMA foreign_key_check').fetchone() is not None:
                raise RuntimeError('Snapshot SQLite foreign_key_check incorrect')
            version = snap.execute('PRAGMA user_version').fetchone()[0]
        pdfs = referenced_pdfs(snapshot)
        manifest = {'format': 'gocmd-full-backup-v1', 'created_utc': datetime.now(timezone.utc).isoformat(),
                    'database': {'path': 'database/gocmd.db', 'bytes': snapshot.stat().st_size,
                                 'sha256': hash_file(snapshot), 'user_version': version},
                    'documents': pdfs, 'document_count': len(pdfs)}
        provisional = Path(td) / 'staged.zip'
        with zipfile.ZipFile(provisional, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            archive.write(snapshot, 'database/gocmd.db')
            for item in pdfs:
                path = docs / item['file']
                if path.is_symlink() or not path.is_file() or not stat.S_ISREG(path.stat().st_mode):
                    raise RuntimeError('Document manquant ou lien symbolique : '+item['file'])
                if path.stat().st_size != item['bytes'] or hash_file(path) != item['sha256']:
                    raise RuntimeError('Document absent/altéré : '+item['file'])
                archive.write(path, 'documents/'+item['file'])
                # Catch a concurrent modification after the archive has read the file.
                if hash_file(path) != item['sha256']:
                    raise RuntimeError('Document modifié pendant la sauvegarde : '+item['file'])
            archive.writestr('manifest.json', json.dumps(manifest, indent=2, ensure_ascii=False).encode('utf-8'))
        with zipfile.ZipFile(provisional) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('Archive ZIP illisible')
            expected = {'manifest.json', 'database/gocmd.db'} | {'documents/'+x['file'] for x in pdfs}
            if set(archive.namelist()) != expected:
                raise RuntimeError('Archive incomplète')
            # Check ZIP contents, not only source files.
            for item in pdfs:
                if hashlib.sha256(archive.read('documents/'+item['file'])).hexdigest() != item['sha256']:
                    raise RuntimeError('Empreinte incorrecte dans le ZIP')
        os.replace(provisional, final)
        if os.name != 'nt':
            os.chmod(final, 0o600)
    old = sorted(out_dir.glob('gocmd_full_*.zip'), reverse=True)
    for candidate in old[retention:]:
        if candidate.is_symlink() or candidate == final:
            continue
        candidate.unlink()
    return final


def main() -> int:
    p = argparse.ArgumentParser(description='Sauvegarde complète GoCmd (SQLite + justificatifs PDF privés)')
    p.add_argument('--source', type=Path)
    p.add_argument('--documents-dir', type=Path)
    p.add_argument('--output-dir', type=Path, required=True)
    p.add_argument('--retention', type=int, default=14)
    args = p.parse_args()
    source = args.source or (Path(os.environ['GOCMD_DB_FILE']) if os.environ.get('GOCMD_DB_FILE') else None)
    if source is None:
        p.error('Source obligatoire : --source ou GOCMD_DB_FILE')
    docs = args.documents_dir or Path(os.environ.get('GOCMD_DOCUMENTS_DIR') or (ROOT.parent / 'gocmd-private-documents'))
    try:
        target = backup(source, docs, args.output_dir, args.retention)
        print(f'BACKUP COMPLET OK: {target} ({target.stat().st_size} octets)')
        print('ATTENTION : ZIP NON CHIFFRÉ. Déplacer vers stockage externe chiffré et contrôler les droits.')
        return 0
    except Exception as ex:
        print('BACKUP COMPLET ÉCHEC : '+str(ex), file=sys.stderr)
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
