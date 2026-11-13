#!/usr/bin/env python3
"""Verify/restore GoCmd full backups to a NEW isolated directory only.

Never overwrites an existing target or touches an active production database.
Secrets and production settings must be provisioned through the separate vault.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import zipfile

NAME_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f-]{27,}\.pdf$')
SHA_RE = re.compile(r'^[0-9a-f]{64}$')


def restore(archive_path: Path, target: Path | None, *, verify_only: bool = False) -> dict:
    archive_path = archive_path.expanduser().resolve()
    if not archive_path.is_file():
        raise RuntimeError('Archive de sauvegarde absente')
    target = target.expanduser().resolve() if target is not None else None
    if not verify_only and (target is None or target.exists()):
        raise RuntimeError('Destination doit être un nouveau répertoire inexistant — aucune écriture sur la production')
    with tempfile.TemporaryDirectory(prefix='gocmd-restore-') as td:
        stage = Path(td)
        (stage / 'database').mkdir(mode=0o700)
        (stage / 'documents').mkdir(mode=0o700)
        with zipfile.ZipFile(archive_path) as z:
            if z.testzip() is not None:
                raise RuntimeError('Archive ZIP corrompue')
            raw_manifest = z.read('manifest.json')
            if len(raw_manifest) > 2 * 1024 * 1024:
                raise RuntimeError('Manifeste trop volumineux')
            manifest = json.loads(raw_manifest)
            if manifest.get('format') != 'gocmd-full-backup-v1':
                raise RuntimeError('Format de sauvegarde incompatible')
            documents = manifest['documents']
            if not isinstance(documents, list) or len(documents) != manifest['document_count']:
                raise RuntimeError('Liste des documents incorrecte')
            expected = {'manifest.json', 'database/gocmd.db'}
            for item in documents:
                name=item['file']; size=item['bytes']; sha=item['sha256']
                if not NAME_RE.fullmatch(name) or not SHA_RE.fullmatch(sha) or not isinstance(size,int) or not 8<=size<=8*1024*1024:
                    raise RuntimeError('Justificatif incorrect dans le manifeste')
                expected.add('documents/'+name)
            if len(expected) != len(z.namelist()) or set(z.namelist()) != expected:
                raise RuntimeError('Fichiers inattendus, doublons ou documents manquants')
            info = z.getinfo('database/gocmd.db')
            if info.file_size != manifest['database']['bytes']:
                raise RuntimeError('Taille du snapshot incohérente')
            db_file = stage / 'database' / 'gocmd.db'
            with z.open('database/gocmd.db') as inp, db_file.open('wb') as out:
                digest=hashlib.sha256()
                for block in iter(lambda: inp.read(1024*1024), b''):
                    digest.update(block);out.write(block)
            if digest.hexdigest()!=manifest['database']['sha256']:
                raise RuntimeError('SHA-256 du snapshot incorrect')
            for item in documents:
                name=item['file']
                info=z.getinfo('documents/'+name)
                if info.file_size!=item['bytes']:
                    raise RuntimeError('Taille PDF incohérente : '+name)
                with z.open(info) as inp, (stage/'documents'/name).open('wb') as out:
                    digest=hashlib.sha256();total=0
                    for block in iter(lambda: inp.read(1024*1024),b''):
                        digest.update(block);out.write(block);total+=len(block)
                if total!=item['bytes'] or digest.hexdigest()!=item['sha256']:
                    raise RuntimeError('Empreinte PDF incorrecte : '+name)
        with sqlite3.connect(f'file:{db_file.as_posix()}?mode=ro',uri=True) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
                raise RuntimeError('Snapshot restauré corrompu')
            if db.execute('PRAGMA foreign_key_check').fetchone():
                raise RuntimeError('FK du snapshot restauré incorrectes')
            rows = db.execute('SELECT storedName,sha256,bytes FROM SupplierOfferAttachment').fetchall()
            expected_records={(x['file'],x['sha256'],x['bytes']) for x in documents}
            if set(rows)!=expected_records or len(rows)!=len(documents):
                raise RuntimeError('Incohérence références base / PDF sauvegardés')
        if not verify_only:
            assert target is not None
            target.parent.mkdir(parents=True,exist_ok=True)
            # Stage on target filesystem before atomic publish to avoid partial restore.
            with tempfile.TemporaryDirectory(prefix='.gocmd-restore-staging-',dir=target.parent) as desttemp:
                publish=Path(desttemp)/'restored'
                publish.mkdir(mode=0o700)
                for folder in ('database','documents'):
                    (publish/folder).mkdir(mode=0o700)
                    for file in (stage/folder).iterdir():
                        output=publish/folder/file.name
                        output.write_bytes(file.read_bytes())
                        if os.name!='nt': os.chmod(output,0o600)
                (publish/'manifest.json').write_bytes(raw_manifest)
                if os.name!='nt': os.chmod(publish/'manifest.json',0o600)
                if target.exists(): raise RuntimeError('Destination devenue existante pendant la restauration')
                os.rename(publish,target)
        return {'verified':True,'files':len(documents),'database_bytes':db_file.stat().st_size,
                'target':str(target) if not verify_only else None}


def main() -> int:
    ap=argparse.ArgumentParser(description='Restaurer une sauvegarde complète GoCmd sur une cible nouvelle')
    ap.add_argument('--archive',type=Path,required=True)
    ap.add_argument('--target-dir',type=Path)
    ap.add_argument('--verify-only',action='store_true')
    args=ap.parse_args()
    if not args.verify_only and args.target_dir is None:
        ap.error('--target-dir requis sauf --verify-only')
    try:
        result=restore(args.archive,args.target_dir,verify_only=args.verify_only)
        print('RESTAURATION VALIDÉE '+json.dumps(result,ensure_ascii=False))
        return 0
    except Exception as exc:
        print('RESTAURATION REFUSÉE : '+str(exc),file=sys.stderr)
        return 1

if __name__=='__main__': raise SystemExit(main())
